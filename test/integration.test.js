import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import { createRiskFirstPolicy, ESCALATE_TOOL } from '../src/policy.js';
import * as RiskFirstPlugin from '../src/index.js';

async function setup(t, { risk = 'medium', outcome = 'allowed-once', guard = false } = {}) {
  const ctx = new Context();
  const fibers = [];
  const load = async (plugin, config) => { const f = ctx.plugin(plugin, config); fibers.push(f); await f.inertia; };
  await load(SystemPrompt);
  await load(ToolRuntime, { mode: 'native' });
  await load(ApprovalService, { policy: 'ask' });
  ctx.provide('permissionPresets', { current: () => 'auto' });
  const events = [
    { seq: 0, type: 'approval/policy', data: { policy: 'ask' } },
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
  ];
  const session = { header: { cwd: '/project' }, get seq() { return events.length; },
    eventAt: seq => events[seq], snapshotEvents: () => events,
    append(type, data) { const event = { type, data, seq: events.length }; events.push(event); return event; } };
  const agent = { id: 'integration-session', session };
  const requests = [];
  const state = { bodies: 0, reviews: 0, outcome, risk };
  ctx.on('approval/request', async req => { requests.push(req); return state.outcome; });
  const policy = createRiskFirstPolicy(ctx, async () => {
    state.reviews++;
    return { risk: state.risk, decision: 'deny', reason: 'Review model: the exact destructive or disclosure effect needs human confirmation.' };
  });
  ctx.tools.register(policy.tool);
  ctx.tools.register({ name: 'danger_action', description: 'Synthetic risky test action; no host effects',
    parameters: { type: 'object', additionalProperties: false,
      properties: { target: { type: 'string' } }, required: ['target'] },
    output: { schema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute() { return { count: ++state.bodies }; },
  });
  ctx.on('tools/pre-execute', (exec, next) => policy.gate(exec, next), { prepend: true });
  if (guard) ctx.tools.guard(exec => exec.name === 'danger_action' ? 'Independent hard guard still denies' : undefined);
  let call = 0;
  const run = (name = 'danger_action', args = { target: 'exact-target' }) => ctx.tools.execute({
    name, arguments: args, agent, callId: `integration-${++call}`, signal: new AbortController().signal,
  });
  const arm = async () => {
    const first = await run(); assert.equal(first.isError, true); assert.equal(requests.length, 0); assert.equal(state.bodies, 0);
    const id = JSON.parse(/risk_ticket=("[^"]+")/.exec(first.error.message)[1]);
    const result = await run(ESCALATE_TOOL, { risk_ticket: id, necessity: 'Exact scope required by the task.',
      risk_reduction_impossible_reason: 'Executing model: retaining or renaming the target does not fulfill the user-requested outcome.',
      alternatives_considered: 'Read-only inspection, reduced scope, and reversible alternatives were considered.' });
    assert.equal(result.isError, false); assert.equal(result.value.status, 'ready_for_approval');
    assert.equal(requests.length, 0); assert.equal(state.bodies, 0);
  };
  t.after(async () => { policy.close(); for (const f of fibers.reverse()) await f.dispose(); });
  return { ctx, events, requests, state, run, arm };
}

test('complete plugin activates, contributes Auto guidance and helper, and unloads cleanly', async () => {
  const ctx = new Context();
  const system = ctx.plugin(SystemPrompt); await system.inertia;
  const tools = ctx.plugin(ToolRuntime, { mode: 'native' }); await tools.inertia;
  const approval = ctx.plugin(ApprovalService, { policy: 'ask' }); await approval.inertia;
  let admission;
  ctx.provide('permissionPresets', { current: () => 'auto', registerAuto(admit) { admission = admit; return () => { admission = undefined; }; } });
  ctx.provide('sessions', { list: () => [] });
  ctx.provide('llm', { stream() { throw new Error('Unexpected review during plugin registration'); } });
  const plugin = ctx.plugin(RiskFirstPlugin); await plugin.inertia;
  assert.equal(typeof admission, 'function'); admission();
  assert.ok(ctx.tools.get(ESCALATE_TOOL));
  const assembly = await ctx.systemPrompt.assemble({ scope: { session: {} } });
  assert.match(assembly.sections.find(s => s.name === 'risk-first-approval').text, /risk_reduction_impossible_reason/);
  await plugin.dispose();
  assert.equal(admission, undefined); assert.equal(ctx.tools.get(ESCALATE_TOOL), undefined);
  await approval.dispose(); await tools.dispose(); await system.dispose();
});

for (const risk of ['medium', 'high']) test(`real DSH pipeline: ${risk} requires explicit intent plus actual human approval, then executes once`, async t => {
  const f = await setup(t, { risk }); await f.arm();
  const result = await f.run(); assert.equal(result.isError, false); assert.equal(f.state.bodies, 1);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].toolName, 'danger_action');
  assert.match(f.requests[0].displayReason.zh, /审批模型判定需人工审批的理由：\nReview model:/);
  assert.match(f.requests[0].displayReason.zh, /执行模型认为无法进一步降低风险的理由：\nExecuting model:/);
  assert.equal(f.events.filter(e => e.type === 'approval/asked').length, 1);
  assert.equal(f.events.find(e => e.type === 'approval/decided').data.outcome, 'allowed-once');
  const repeat = await f.run(); assert.equal(repeat.isError, true);
  assert.equal(f.state.bodies, 1); assert.equal(f.requests.length, 1);
});
for (const outcome of ['rejected', 'cancelled', 'unavailable']) test(`real approval ${outcome} never executes the pending body`, async t => {
  const f = await setup(t, { risk: 'high', outcome }); await f.arm();
  assert.equal((await f.run()).isError, true); assert.equal(f.state.bodies, 0);
  assert.equal(f.events.find(e => e.type === 'approval/decided').data.outcome, outcome);
});
test('actual approval never policy suppresses prompts even after an intent was armed', async t => {
  const f = await setup(t, { risk: 'high' }); await f.arm();
  f.events.push({ seq: f.events.length, type: 'approval/policy', data: { policy: 'never' } });
  assert.equal((await f.run()).isError, true); assert.equal(f.requests.length, 0); assert.equal(f.state.bodies, 0);
});
test('human approval cannot bypass an independent monotonic tool guard', async t => {
  const f = await setup(t, { risk: 'high', guard: true }); await f.arm();
  const result = await f.run(); assert.equal(result.isError, true);
  assert.match(result.error.message, /Independent hard guard/); assert.equal(f.state.bodies, 0);
  assert.equal(f.requests.length, 1);
});
