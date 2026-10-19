import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { REVIEWER_RETRY_POLICY, ReviewerRequestError, withReviewerRetry, waitForReviewerRetry } from '../src/reviewer-retry.js';
import { classifyRisk, readDecision } from '../src/upstream-review.js';
import { makeSmokeFixture } from '../smoke/fixture.js';

const allow = { risk: 'low', decision: 'allow' };
const deny = { risk: 'high', decision: 'deny', reason: 'Sensitive effect requires human approval' };
const failure = (code = 'TIMEOUT', extra = {}) => new ReviewerRequestError('error', { code, message: 'Synthetic transient failure', ...extra });
async function* answer(decision = allow) {
  const text = typeof decision === 'string' ? decision : JSON.stringify(decision);
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}
async function* terminal(code = 'TIMEOUT', kind = 'error') {
  yield { type: 'finish', reason: { kind, failure: { code, message: 'Request timed out.' } } };
}
const noWait = async () => {};

for (const code of ['TIMEOUT', 'TRANSPORT', 'SERVER', 'RATE_LIMIT', 'EMPTY_RESPONSE']) {
  test(`${code} retries internally and returns the recovered decision`, async () => {
    let attempts = 0; const delays = [];
    const result = await withReviewerRetry(async () => {
      if (++attempts < 3) throw failure(code);
      return allow;
    }, { wait: async delay => delays.push(delay), random: () => 0.5 });
    assert.deepEqual(result, allow); assert.equal(attempts, 3);
    assert.deepEqual(delays, [500, 1000]);
  });
}
test('retry exhaustion is bounded to four attempts and preserves last structured failure', async () => {
  let attempts = 0; const delays = [];
  await assert.rejects(withReviewerRetry(async () => { attempts++; throw failure('TRANSPORT', { requestId: 'last-request' }); },
    { wait: async delay => delays.push(delay), random: () => 0.5 }), error => {
    assert.equal(error.code, 'TRANSPORT'); assert.equal(error.attempts, 4);
    assert.equal(error.failure.requestId, 'last-request'); assert.match(error.message, /4 attempts; 3 retries/);
    return true;
  });
  assert.equal(attempts, 4); assert.deepEqual(delays, [500, 1000, 2000]);
});
test('jitter stays inside the promised twenty percent envelope', async () => {
  for (const [random, expected] of [[0, [400, 800, 1600]], [1, [600, 1200, 2400]]]) {
    const delays = []; let attempts = 0;
    await withReviewerRetry(async () => { if (++attempts <= 3) throw failure(); return allow; },
      { wait: async delay => delays.push(delay), random: () => random });
    assert.deepEqual(delays, expected);
  }
});
test('positive providerRetryAfterMs is respected exactly within the wait cap', async () => {
  const delays = []; let attempts = 0;
  await withReviewerRetry(async () => { if (++attempts === 1) throw failure('RATE_LIMIT', { providerRetryAfterMs: 8000 }); return allow; },
    { wait: async delay => delays.push(delay) });
  assert.deepEqual(delays, [8000]); assert.equal(attempts, 2);
});
test('over-cap providerRetryAfterMs fails closed instead of retrying too early', async () => {
  let attempts = 0, waits = 0;
  await assert.rejects(withReviewerRetry(async () => { attempts++; throw failure('RATE_LIMIT', { providerRetryAfterMs: 10_001 }); },
    { wait: async () => waits++ }), /RATE_LIMIT/);
  assert.equal(attempts, 1); assert.equal(waits, 0);
});
for (const value of [undefined, 0, -1, NaN, Infinity, '100']) {
  test(`invalid provider delay ${String(value)} uses local backoff`, async () => {
    const delays = []; let attempts = 0;
    await withReviewerRetry(async () => { if (++attempts === 1) throw failure('SERVER', { providerRetryAfterMs: value }); return allow; },
      { wait: async delay => delays.push(delay), random: () => 0.5 });
    assert.deepEqual(delays, [500]);
  });
}
for (const code of ['AUTH', 'QUOTA', 'INVALID_ARGS', 'CONTEXT_WINDOW_EXCEEDED', 'PROTOCOL', 'UNKNOWN', 'ABORTED']) {
  test(`${code} is not retried`, async () => {
    let attempts = 0;
    await assert.rejects(withReviewerRetry(async () => { attempts++; throw failure(code); }, { wait: noWait }), error => error.code === code);
    assert.equal(attempts, 1);
  });
}
test('risk denials are final decisions, never requests for a better answer', async () => {
  let attempts = 0;
  assert.deepEqual(await withReviewerRetry(async () => { attempts++; return deny; }), deny);
  assert.equal(attempts, 1);
});
test('aborted terminal finishes never retry, even with a transient code', async () => {
  for (const code of ['TIMEOUT', 'TRANSPORT', 'SERVER']) {
    let attempts = 0;
    await assert.rejects(withReviewerRetry(async () => { attempts++; return readDecision(terminal(code, 'aborted')); }, { wait: noWait }), /aborted/);
    assert.equal(attempts, 1);
  }
});
test('arbitrary thrown exceptions are not retried by code or message matching', async () => {
  for (const error of [new Error('TIMEOUT: Request timed out'), Object.assign(new Error('middleware failed'), { code: 'TIMEOUT' })]) {
    let attempts = 0;
    await assert.rejects(withReviewerRetry(async () => { attempts++; throw error; }, { wait: noWait }), thrown => thrown === error);
    assert.equal(attempts, 1);
  }
});
test('abort before request, during wait, or immediately after success never continues', async () => {
  const before = new AbortController(); before.abort(new Error('cancel-before'));
  let attempts = 0;
  await assert.rejects(withReviewerRetry(async () => { attempts++; return allow; }, { signal: before.signal }), /cancel-before/);
  assert.equal(attempts, 0);
  const waiting = new AbortController();
  await assert.rejects(withReviewerRetry(async () => { attempts++; throw failure(); }, {
    signal: waiting.signal, wait: async () => waiting.abort(new Error('cancel-wait')),
  }), /cancel-wait/);
  assert.equal(attempts, 1);
  const after = new AbortController();
  await assert.rejects(withReviewerRetry(async () => { after.abort(new Error('cancel-after')); return allow; }, { signal: after.signal }), /cancel-after/);
});
test('real wait clears its timer and abort listener on cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const waiting = waitForReviewerRetry(500, controller.signal);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  const rejection = assert.rejects(waiting, /stop-wait/);
  controller.abort(new Error('stop-wait')); await rejection;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  t.mock.timers.tick(10_000);
});
test('real wait removes abort listener when delay completes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const waiting = waitForReviewerRetry(500, controller.signal);
  t.mock.timers.tick(500); await waiting;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test('policy defaults cannot be mutated', () => {
  assert.ok(Object.isFrozen(REVIEWER_RETRY_POLICY));
  assert.equal(REVIEWER_RETRY_POLICY.maxRetries, 3);
});

function fixture(stream) {
  const signal = new AbortController().signal;
  const f = makeSmokeFixture({ provider: 'fake', model: 'unit', reasoningEffort: 'low' }, 'session', signal);
  const requests = [];
  return { ...f, requests, ctx: { llm: { stream(options) { requests.push(options); return stream(requests.length); } } } };
}
async function advanceRetries(t) {
  // Flush microtasks before each fake timer tick; no network or real sleeps.
  for (let i = 0; i < 4; i++) { await nextTurn(); t.mock.timers.tick(10_000); }
  await nextTurn();
}
test('classifyRisk retries partial failures with the exact same frozen request and a new assembler', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(async function* (attempt) {
    if (attempt === 1) {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: '{"risk":"low","decision":"allow"' };
      yield* terminal();
    } else yield* answer(deny);
  });
  const result = classifyRisk(f.ctx, f.agent, f.exec, f.exec.signal);
  await advanceRetries(t);
  assert.deepEqual(await result, deny); assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0], f.requests[1]);
  assert.ok(Object.isFrozen(f.requests[0].messages[0].content));
});
test('classifyRisk exhaustion returns a technical error after exactly four streams', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(() => terminal());
  const rejected = assert.rejects(classifyRisk(f.ctx, f.agent, f.exec, f.exec.signal), /4 attempts; 3 retries/);
  await advanceRetries(t); await rejected; assert.equal(f.requests.length, 4);
});
for (const text of ['not json', '{"risk":"high","decision":"allow"}', '{"risk":"high","decision":"deny"}']) {
  test(`classifyRisk does not retry invalid protocol: ${text}`, async () => {
    const f = fixture(() => answer(text));
    await assert.rejects(classifyRisk(f.ctx, f.agent, f.exec, f.exec.signal));
    assert.equal(f.requests.length, 1);
  });
}
test('missing terminal finish is a protocol failure, not a guessed transport retry', async () => {
  const f = fixture(async function* () { yield { type: 'block-start', index: 0, blockType: 'text' }; });
  await assert.rejects(classifyRisk(f.ctx, f.agent, f.exec, f.exec.signal), /no terminal finish/);
  assert.equal(f.requests.length, 1);
});
test('first-attempt success does not sleep or duplicate its request', async () => {
  let attempts = 0, waits = 0;
  assert.deepEqual(await withReviewerRetry(async () => { attempts++; return allow; }, { wait: async () => waits++ }), allow);
  assert.equal(attempts, 1); assert.equal(waits, 0);
});
test('concurrent reviewer calls have independent retry budgets', async () => {
  const counts = [0, 0];
  const results = await Promise.all(counts.map((_value, i) => withReviewerRetry(async () => {
    if (++counts[i] <= i + 1) throw failure(); return allow;
  }, { wait: noWait })));
  assert.deepEqual(counts, [2, 3]); assert.deepEqual(results, [allow, allow]);
});
test('a cleanup exception after error finish is not masked or automatically retried', async () => {
  let cleaned = 0;
  const f = fixture(async function* () {
    try { yield* terminal(); }
    finally { cleaned++; throw Object.assign(new Error('synthetic iterator cleanup failure'), { code: 'TIMEOUT' }); }
  });
  await assert.rejects(classifyRisk(f.ctx, f.agent, f.exec, f.exec.signal), /iterator cleanup failure/);
  assert.equal(cleaned, 1); assert.equal(f.requests.length, 1);
});
test('data after an error finish is a protocol failure, not a retryable TIMEOUT', async () => {
  const f = fixture(async function* () { yield* terminal(); yield { type: 'text-delta', index: 0, text: 'unexpected' }; });
  await assert.rejects(classifyRisk(f.ctx, f.agent, f.exec, f.exec.signal), /after its terminal finish/);
  assert.equal(f.requests.length, 1);
});
test('even a complete allow JSON is discarded if its attempt ends with TIMEOUT', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(async function* (attempt) {
    if (attempt === 1) {
      for await (const chunk of answer()) if (chunk.type !== 'finish') yield chunk;
      yield* terminal();
    } else yield* answer(deny);
  });
  const pending = classifyRisk(f.ctx, f.agent, f.exec, f.exec.signal);
  await advanceRetries(t);
  assert.deepEqual(await pending, deny); assert.equal(f.requests.length, 2);
});
test('metadata and configured route are resolved once, not changed between retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const route = { provider: 'dedicated', model: 'reviewer', reasoningEffort: 'low' };
  let metadata = 0;
  const f = fixture(attempt => {
    if (attempt === 1) { route.provider = 'changed'; f.config.model = 'changed'; return terminal(); }
    return answer();
  });
  f.ctx.llm.resolveModelInfo = async () => { metadata++; return { reasoning: { efforts: [{ id: 'low' }] } }; };
  const pending = classifyRisk(f.ctx, f.agent, f.exec, f.exec.signal, route);
  await advanceRetries(t); assert.deepEqual(await pending, allow);
  assert.equal(metadata, 1); assert.equal(f.requests[0], f.requests[1]);
  assert.equal(f.requests[1].provider, 'dedicated'); assert.equal(f.requests[1].model, 'reviewer');
});
for (const kind of ['max-tokens', 'tool-calls']) test(`${kind} terminal finish does not retry`, async () => {
  const f = fixture(async function* () { yield { type: 'finish', reason: { kind } }; });
  await assert.rejects(classifyRisk(f.ctx, f.agent, f.exec, f.exec.signal), new RegExp(kind));
  assert.equal(f.requests.length, 1);
});
test('stop with no text block does not retry', async () => {
  const f = fixture(async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; });
  await assert.rejects(classifyRisk(f.ctx, f.agent, f.exec, f.exec.signal), /exactly one text block/);
  assert.equal(f.requests.length, 1);
});
test('request failure keeps structured metadata rather than parsing its message', async () => {
  await assert.rejects(readDecision(terminal('TIMEOUT')), error => {
    assert.ok(error instanceof ReviewerRequestError); assert.equal(error.finishKind, 'error');
    assert.equal(error.failure.code, 'TIMEOUT'); assert.ok(Object.isFrozen(error.failure)); return true;
  });
});
