import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { TOOL_NAME, DESCRIPTION, PARAMETERS, OUTPUT, GUIDANCE } from './tool-contract.js';

// This module NEVER imports the watched engine or its policy/reviewer helpers.
// HMR must not dispose this owner when replacing the implementation service.
export const name = 'risk-first-stable-guard';
export const inject = ['approval', 'permissionPresets', 'sessions', 'tools', 'systemPrompt'];
const REPORT = '/Users/huangweihao/workspace/05.projects/dsh-risk-first-approval/_scratch/hmr-state.json';

export function apply(ctx, config = {}) {
  const guardId = randomUUID();
  const leases = new WeakMap();
  const active = new Set();
  const history = [];
  let accepting = true, writes = Promise.resolve();
  const isAuto = agent => agent && ctx.permissionPresets.current(agent.session) === 'auto';
  // Optional lookup is deliberate: dependency injection must not restart this
  // owner when the engine service disappears/reappears during HMR.
  const currentEngine = () => ctx.get('riskFirstHotEngine');
  const ready = engine => Boolean(engine?.ready);
  function snapshot(reason) {
    const engine = currentEngine();
    return { reason, pid: process.pid, guardId, guardReady: accepting,
      engineReady: ready(engine), engineGeneration: engine?.generation ?? null,
      engineBuild: engine?.build ?? null, timestamp: new Date().toISOString(),
      autoSessionCount: ctx.sessions.list().filter(s => ctx.permissionPresets.current(s) === 'auto').length };
  }
  function notify(reason) {
    const value = snapshot(reason); history.push(value); if (history.length > 32) history.shift();
    if (config.diagnostics === false) return;
    const report = JSON.stringify({ ...value, history: [...history] }, null, 2);
    writes = writes.catch(() => {}).then(async () => { await mkdir(dirname(REPORT), { recursive: true }); await writeFile(REPORT, report); });
    // Diagnostics must never turn a failed report write into execution permission.
    writes.catch(error => ctx.logger.warn('Risk-first HMR report failed: %s', String(error)));
  }
  const denied = reason => ({ kind: 'deny', reason,
    info: { name: 'AutoReviewUnavailableError', code: 'AUTO_REVIEW_RELOADING' } });
  function leaseFailure(exec) {
    const lease = leases.get(exec);
    if (!lease) return isAuto(exec.agent) && !(exec.parent === undefined && exec.name === 'run_code')
      ? 'Auto review has no valid execution lease; the body was not executed.' : undefined;
    if (!accepting || !isAuto(exec.agent) || !ready(lease.engine) || currentEngine() !== lease.engine) {
      return 'The review engine or permission context changed before dispatch; the body was not executed. Retry after reload.';
    }
  }
  async function tracked(operation) {
    const completed = Promise.withResolvers(); active.add(completed.promise);
    try { return await operation(); } finally { active.delete(completed.promise); completed.resolve(); }
  }
  const tool = { name: TOOL_NAME, description: DESCRIPTION, parameters: PARAMETERS, output: OUTPUT,
    async execute(args, exec) {
      const lease = leases.get(exec);
      const failure = leaseFailure(exec);
      if (failure || !lease) return { status: 'not_armed', message: failure ?? 'No current Auto review intent can be recorded outside Auto mode.' };
      return tracked(() => lease.engine.request(args, exec));
    },
  };
  ctx.effect(function* () {
    yield ctx.provide('riskFirstHotGuard', { guardId, notify, status: () => snapshot('status') });
    yield ctx.tools.register(tool);
    yield ctx.systemPrompt.section({ name: 'risk-first-approval', order: 950,
      text(context) { return isAuto(context.agent ?? context.scope) ? GUIDANCE : ''; } });
    yield ctx.on('tools/pre-execute', async (exec, next) => {
      if (!isAuto(exec.agent) || (exec.parent === undefined && exec.name === 'run_code')) return next();
      if (!accepting || exec.signal.aborted) return { kind: 'cancel' };
      const engine = currentEngine();
      if (!ready(engine)) return denied('Auto review is reloading or unavailable. The body was not executed; no human approval was requested. Retry once the engine is ready.');
      leases.set(exec, { engine });
      return tracked(async () => {
        // Only this exact inert recorder is exempt from its own risk classifier;
        // downstream pre-execute handlers and monotonic guards still run.
        const result = exec.name === TOOL_NAME && ctx.tools.get(exec.name, exec.agent) === tool
          ? await next() : await engine.gate(exec, next);
        if (result.kind === 'allow' || result.kind === 'ask') {
          const failure = leaseFailure(exec); if (failure) return denied(failure);
        }
        return result;
      });
    }, { prepend: true });
    // This runs AFTER an awaited human answer as well as after ordinary allows.
    // Approval of an old-generation call never grants a new implementation.
    yield ctx.tools.guard(leaseFailure);
    yield ctx.permissionPresets.registerAuto(() => {
      if (!accepting || !ready(currentEngine())) throw new Error('Auto review engine is not ready; retry when loading completes');
    });
    notify('guard-ready');
    yield async () => {
      accepting = false;
      currentEngine()?.quiesce?.();
      // Engine-only HMR never reaches this branch. On an actual owner removal,
      // confine remaining Auto sessions rather than silently granting Full access.
      // This canonical writer does not change the user's approval policy.
      for (const session of ctx.sessions.list()) {
        if (ctx.permissionPresets.current(session) === 'auto') setSandboxMode(session, 'read-only');
      }
      notify('guard-stopping');
      await Promise.allSettled([...active]);
      await writes.catch(() => {});
    };
  }, 'stable risk-first authorization owner');
}
