import { writeFile, mkdir } from 'node:fs/promises';
import { classifyRisk, reviewerReasoningEffort } from './reviewer.js';
import { makeSmokeFixture } from './fixture.js';

export const name = 'risk-first-reviewer-smoke';
export const inject = ['llm', 'sessions'];
const REPORT_DIR = '/Users/huangweihao/workspace/05.projects/dsh-risk-first-approval/_scratch';
const REPORT = `${REPORT_DIR}/reviewer-smoke-0.1.2.json`;

export function apply(ctx, config) {
  const session = ctx.sessions.list().find(value => value.header.id === config.sessionId);
  const current = session?.requestHeader()?.config;
  if (!current?.provider || !current?.model) throw new Error('Smoke target has no current model header; no model call was made');
  const route = { provider: current.provider, model: current.model,
    ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort }) };
  ctx.effect(() => {
    const stop = new AbortController();
    const timeout = AbortSignal.timeout(120_000);
    const signal = AbortSignal.any([stop.signal, timeout]);
    const report = { version: '0.1.2', status: 'running', sessionId: config.sessionId, results: [] };
    const save = async () => { await mkdir(REPORT_DIR, { recursive: true }); await writeFile(REPORT, JSON.stringify(report, null, 2)); };
    const task = (async () => {
      try {
        await save();
        for (const mode of ['session', 'implicit']) {
          const fixture = makeSmokeFixture(route, mode, signal);
          const effort = await reviewerReasoningEffort(ctx, fixture.config, signal);
          if (effort !== undefined) fixture.config.reasoningEffort = effort;
          const started = Date.now();
          const result = await classifyRisk(ctx, fixture.agent, fixture.exec, signal);
          report.results.push({ mode, provider: route.provider, model: route.model, reasoningEffort: effort,
            risk: result.risk, decision: result.decision, elapsedMs: Date.now() - started,
            ok: result.risk === 'low' && result.decision === 'allow' });
          await save();
        }
        report.status = report.results.every(item => item.ok) ? 'passed' : 'failed';
      } catch (error) {
        report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
      }
      await save();
    })();
    // An explicitly owned, bounded task. Removing the diagnostic aborts and joins it.
    return async () => { stop.abort(new Error('diagnostic removed')); await task; };
  }, 'bounded synthetic reviewer smoke test');
}
