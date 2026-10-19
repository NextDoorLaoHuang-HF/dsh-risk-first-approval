// Direct llm.stream() consumers do not use DSH's agent-loop retry executor.
// Keep recovery inside the reviewer: never re-dispatch the pending tool body.
export const REVIEWER_RETRY_POLICY = Object.freeze({
  maxRetries: 3, initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.2,
});
const RETRYABLE_CODES = new Set(['TIMEOUT', 'TRANSPORT', 'SERVER', 'RATE_LIMIT', 'EMPTY_RESPONSE']);

/** Only a structured terminal provider failure can enter automatic recovery. */
export class ReviewerRequestError extends Error {
  constructor(finishKind, failure, attempts = 1) {
    const suffix = attempts > 1 ? ` (after ${attempts} attempts; ${attempts - 1} retries)` : '';
    super(`auto-review: reviewer ended with ${finishKind} ${failure.code}: ${failure.message}${suffix}`);
    this.name = 'ReviewerRequestError';
    this.finishKind = finishKind;
    this.failure = Object.freeze({ ...failure });
    this.code = failure.code;
    this.attempts = attempts;
  }
}

/** A bounded wait owned by the request/lifecycle signal; no detached timer. */
export function waitForReviewerRetry(delayMs, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    function onAbort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryDelay(failure, retry, random) {
  const policy = REVIEWER_RETRY_POLICY;
  const providerDelay = failure.providerRetryAfterMs;
  if (Number.isFinite(providerDelay) && providerDelay > 0) {
    // Never retry earlier than requested, nor let a provider impose a long hang.
    return providerDelay <= policy.maxDelayMs ? providerDelay : undefined;
  }
  const base = Math.min(policy.initialDelayMs * 2 ** (retry - 1), policy.maxDelayMs);
  return Math.min(policy.maxDelayMs, Math.round(base * (1 - policy.jitterRatio + 2 * policy.jitterRatio * random())));
}

/** Retry one frozen review, discarding failed partial output on every attempt.
 * wait/random are test seams, not plugin settings or model-call arguments.
 */
export async function withReviewerRetry(attempt, { signal, wait = waitForReviewerRetry, random = Math.random } = {}) {
  for (let attempts = 1; ; attempts++) {
    signal?.throwIfAborted();
    try {
      const decision = await attempt();
      signal?.throwIfAborted();
      return decision;
    } catch (error) {
      signal?.throwIfAborted();
      // Abort, protocol, config, middleware, cleanup and arbitrary thrown errors
      // must fail closed, even when their message happens to say TIMEOUT.
      if (!(error instanceof ReviewerRequestError) || error.finishKind !== 'error' || !RETRYABLE_CODES.has(error.code)) throw error;
      if (attempts > REVIEWER_RETRY_POLICY.maxRetries) {
        throw new ReviewerRequestError(error.finishKind, error.failure, attempts);
      }
      const delayMs = retryDelay(error.failure, attempts, random);
      if (delayMs === undefined) throw new ReviewerRequestError(error.finishKind, error.failure, attempts);
      await wait(delayMs, signal);
    }
  }
}
