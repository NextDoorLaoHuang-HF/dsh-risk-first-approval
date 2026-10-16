import { randomUUID } from 'node:crypto';
import { classifyRisk } from './upstream-review.js';
import { createRiskFirstPolicy } from './policy.js';

export const BUILD = 'risk-first-0.1.2-hot-c';
export const name = 'risk-first-hot-engine';
export const inject = ['approval', 'llm', 'permissionPresets', 'tools'];

// No Auto contribution, tool registration, or session-mode writer lives here.
// This module and its policy/reviewer dependencies may be replaced independently.
export function apply(ctx) {
  const policy = createRiskFirstPolicy(ctx, classifyRisk);
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
    gate: (exec, next) => tracked(() => policy.gate(exec, next)),
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
