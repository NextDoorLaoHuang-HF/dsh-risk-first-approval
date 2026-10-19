import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRisk } from './upstream-review.js';
import { createRiskFirstPolicy } from './policy.js';
import { ReviewerRouteConfig, readLiveConfig, resolveReviewerRoute } from './reviewer-route.js';

// TEMPORARY diagnosis probe (2026-10-17): one JSON line per gate/classify,
// answering whether preset-realm tool executions reach the host-mounted
// review engine at all, and with what agent binding. Remove after verdict.
const PROBE_FILE = fileURLToPath(new URL('../_scratch/review-probe.log', import.meta.url));
function probe(entry) {
  try {
    mkdirSync(dirname(PROBE_FILE), { recursive: true });
    appendFileSync(PROBE_FILE, JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, ...entry }) + '\n');
  } catch { /* diagnostics must never break the engine */ }
}

export const BUILD = 'risk-first-0.1.12-hot-retry';
export const Config = ReviewerRouteConfig;
export const name = 'risk-first-hot-engine';
export const inject = ['approval', 'llm', 'permissionPresets', 'tools'];

// No Auto contribution, tool registration, or session-mode writer lives here.
// This module and its policy/reviewer dependencies may be replaced independently.
export function apply(ctx, config = {}) {
  // Resolve lazily so Settings edits reach the next review without a reload;
  // Loader volatile refs update in place, plain values keep working too.
  const reviewer = () => resolveReviewerRoute({
    reviewerProvider: readLiveConfig(config.reviewerProvider),
    reviewerModel: readLiveConfig(config.reviewerModel),
    reviewerReasoningEffort: readLiveConfig(config.reviewerReasoningEffort),
  });
  const policy = createRiskFirstPolicy(ctx, (reviewCtx, agent, exec, signal, route) => {
    probe({ event: 'classify', name: exec?.name, provider: route?.provider ?? null, model: route?.model ?? null, effort: route?.reasoningEffort ?? null, agentDefined: agent !== undefined, session: agent?.session?.id ?? null });
    return classifyRisk(reviewCtx, agent, exec, signal, route).then(result => {
      probe({ event: 'classify-result', name: exec?.name, decision: result?.decision ?? null, risk: result?.risk ?? null, reason: result?.reason ?? null });
      return result;
    });
  }, { reviewer });
  const active = new Set();
  let accepting = true;
  const notify = reason => ctx.get('riskFirstHotGuard')?.notify(reason);
  function quiesce() {
    if (!accepting) return;
    accepting = false; policy.close(); notify('engine-stopping');
  }
  async function tracked(operation) {
    if (!accepting) throw new Error('Auto review engine is closing; retry after reload');
    const completed = Promise.withResolvers(); active.add(completed.promise);
    try { return await operation(); } finally { active.delete(completed.promise); completed.resolve(); }
  }
  const engine = {
    generation: randomUUID(), build: BUILD,
    get ready() { return accepting; },
    gate: (exec, next) => tracked(() => {
      probe({ event: 'gate', name: exec?.name, agentDefined: exec?.agent !== undefined, session: exec?.agent?.session?.id ?? null, parent: exec?.parent ?? null });
      return Promise.resolve(policy.gate(exec, next)).then(result => {
        probe({ event: 'gate-result', name: exec?.name, kind: result?.kind ?? null });
        return result;
      });
    }),
    request: (args, exec) => tracked(() => policy.tool.execute(args, exec)),
    quiesce,
  };
  ctx.effect(function* () {
    yield ctx.provide('riskFirstHotEngine', engine);
    yield async () => { quiesce(); await Promise.allSettled([...active]); };
    // A strict ctx.get() hides services whose providing fiber is still
    // initializing, so defer the ready report until this fiber settles.
    // The guard may also start after this engine at boot; retry briefly.
    void (async () => {
      await ctx.fiber.await().catch(() => {});
      for (let i = 0; i < 100 && accepting && !ctx.get('riskFirstHotGuard'); i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (accepting) notify('engine-ready');
    })();
  }, 'replaceable risk-first review engine');
}
