import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import * as Guard from '../hot/guard/index.js';
import * as HotEngine from '../src/hot-engine.js';

async function fixture(t, options = {}) {
  const ctx = new Context(), fibers = [];
  const load = async (plugin, config) => { const f = ctx.plugin(plugin, config); fibers.push(f); await f.inertia; return f; };
  await load(SystemPrompt); await load(ToolRuntime, { mode: 'native' }); await load(ApprovalService, { policy: 'ask' });
  const state = { mode: 'auto', bodies: 0, asks: 0, contributions: 0 };
  const events = [{ seq: 0, type: 'approval/policy', data: { policy: options.approval ?? 'ask' } }, { seq: 1, type: 'turn/start', data: { turn: 1 } }];
  const session = { header: { id: 'hot-test', cwd: '/project' }, get seq() { return events.length; },
    eventAt: i => events[i], snapshotEvents: () => events,
    append(type, data) { const value = { type, data, seq: events.length }; events.push(value); if (type === 'sandbox/mode') state.mode = 'custom'; return value; } };
  const agent = { id: 'hot-test', session };
  if (options.logReview) {
    session.surface = { nodes: [] }; session.isOwnSeq = () => true;
    session.requestHeader = () => ({ config: { provider: 'fake', model: 'unit', reasoningEffort: 'low' }, tools: ctx.tools.schemas(agent) });
    const user = session.append('user/message', { source: { kind: 'user', rpcId: 'unit' }, content: [{ type: 'text', text: 'Test the synthetic inert approval flow only.' }] });
    session.surface.nodes.push(user.seq);
  }
  ctx.provide('permissionPresets', { current: () => state.mode,
    registerAuto(admit) { state.contributions++; state.admit = admit; return () => { state.contributions--; }; } });
  ctx.provide('sessions', { list: () => options.includeSession ? [session] : [] });
  ctx.on('approval/request', async req => { state.asks++; if (options.answer) return options.answer(req); return 'allowed-once'; });
  const definition = { name: 'inert', description: 'Pure synthetic return, no host effects', parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'], additionalProperties: false }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute() { return { count: ++state.bodies }; } };
  ctx.tools.register(definition);
  let generation = 0, removeEngine;
  function installEngine(gate = (_exec, next) => next()) {
    removeEngine?.();
    let ready = true;
    const engine = { generation: `g${++generation}`, build: 'synthetic-test', get ready() { return ready; }, gate,
      async request() { return { status: 'ready_for_approval', message: 'Only an intent was recorded' }; },
      quiesce() { ready = false; } };
    removeEngine = ctx.provide('riskFirstHotEngine', engine); return engine;
  }
  if (!options.missingEngine) installEngine(options.gate);
  const guard = await load(Guard, { diagnostics: false });
  let serial = 0;
  const run = (name = 'inert', args = {}, signal = new AbortController().signal) => {
    const callId = `hot-${++serial}`;
    if (options.logReview) {
      session.append('step/start', { turn: 1, step: serial });
      const message = session.append('assistant/message', { turn: 1, step: serial, message: { content: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }] } });
      session.surface.nodes.push(message.seq);
      session.append('tool/call', { turn: 1, step: serial, callId, name, arguments: JSON.stringify(args) });
    }
    return ctx.tools.execute({ name, arguments: args, agent, callId, signal });
  };
  t.after(async () => { for (const f of fibers.reverse()) await f.dispose(); removeEngine?.(); });
  return { ctx, state, events, session, agent, guard, run, load, installEngine, removeEngine: () => { removeEngine?.(); removeEngine = undefined; } };
}

test('missing hot engine fails closed, retains Auto, and never asks the human', async t => {
  const f = await fixture(t, { missingEngine: true });
  const result = await f.run(); assert.equal(result.isError, true); assert.match(result.error.message, /reloading or unavailable/);
  assert.equal(f.state.mode, 'auto'); assert.equal(f.state.bodies, 0); assert.equal(f.state.asks, 0);
  assert.equal(f.state.contributions, 1); assert.throws(() => f.state.admit(), /not ready/);
});
test('engine replacement does not remove the stable guard or Auto contribution', async t => {
  const f = await fixture(t); const guardId = f.ctx.get('riskFirstHotGuard').guardId;
  assert.equal((await f.run()).isError, false);
  f.removeEngine(); assert.equal((await f.run()).isError, true);
  f.installEngine(); assert.equal((await f.run()).isError, false);
  assert.equal(f.ctx.get('riskFirstHotGuard').guardId, guardId); assert.equal(f.state.contributions, 1);
  assert.equal(f.state.mode, 'auto'); assert.equal(f.state.bodies, 2);
});
test('old-generation human approval cannot execute after an engine replacement', async t => {
  let f;
  f = await fixture(t, { gate: async () => ({ kind: 'ask', reason: 'Synthetic UI boundary' }), answer: async () => { f.installEngine(); return 'allowed-once'; } });
  const result = await f.run(); assert.equal(result.isError, true); assert.match(result.error.message, /changed before dispatch/);
  assert.equal(f.state.asks, 1); assert.equal(f.state.bodies, 0); assert.equal(f.state.mode, 'auto');
});
test('a review resolving after its engine closes cannot dispatch', async t => {
  const review = Promise.withResolvers();
  const f = await fixture(t, { gate: () => review.promise });
  const pending = f.run();
  // The original engine must retain its lease even if it returns an allow late.
  const engine = f.ctx.get('riskFirstHotEngine'); engine.quiesce(); review.resolve({ kind: 'allow' });
  const result = await pending; assert.equal(result.isError, true); assert.equal(f.state.bodies, 0);
});
test('helper uses the current engine but still grants no execution permission', async t => {
  const f = await fixture(t, { gate: async () => { throw new Error('The inert helper must not classify itself'); } });
  const result = await f.run('request_risk_approval', { risk_ticket: 'test', necessity: 'test', risk_reduction_impossible_reason: 'test', alternatives_considered: 'test' });
  assert.equal(result.isError, false); assert.equal(result.value.status, 'ready_for_approval');
  assert.equal(f.state.asks, 0); assert.equal(f.state.bodies, 0);
});
test('non-Auto sessions retain ordinary behavior when the engine is absent', async t => {
  const f = await fixture(t, { missingEngine: true }); f.state.mode = 'danger-full-access';
  assert.equal((await f.run()).isError, false); assert.equal(f.state.bodies, 1);
});
test('actual hot engine plus stable helper completes the risk-first approval flow', async t => {
  const f = await fixture(t, { missingEngine: true, logReview: true });
  const text = JSON.stringify({ risk: 'high', decision: 'deny', reason: 'Synthetic reviewer reason for an approval test.' });
  f.ctx.provide('llm', { async *stream() {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } });
  await f.load(HotEngine);
  const first = await f.run(); assert.equal(first.isError, true); assert.equal(f.state.asks, 0);
  const risk_ticket = JSON.parse(/risk_ticket=("[^"]+")/.exec(first.error.message)[1]);
  const arm = await f.run('request_risk_approval', { risk_ticket, necessity: 'Test exact synthetic boundary', risk_reduction_impossible_reason: 'Skipping the prompt would skip the boundary under test', alternatives_considered: 'Unit tests already passed; this tests the real pipeline' });
  assert.equal(arm.isError, false); assert.equal(arm.value.status, 'ready_for_approval');
  const approved = await f.run(); assert.equal(approved.isError, false); assert.equal(f.state.bodies, 1); assert.equal(f.state.asks, 1);
  assert.equal((await f.run()).isError, true); assert.equal(f.state.bodies, 1); assert.equal(f.state.asks, 1);
});

async function* retryAnswer() {
  const text = '{"risk":"low","decision":"allow"}';
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}
async function* retryTimeout() {
  yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TIMEOUT', message: 'Synthetic request timeout' } } };
}

test('real Tools + HotEngine recover two timeouts and execute the original body exactly once', async t => {
  const f = await fixture(t, { missingEngine: true, logReview: true });
  let requests = 0;
  f.ctx.provide('llm', { stream() { return ++requests <= 2 ? retryTimeout() : retryAnswer(); } });
  await f.load(HotEngine);
  const result = await f.run();
  assert.equal(result.isError, false); assert.equal(requests, 3);
  assert.equal(f.state.bodies, 1); assert.equal(f.state.asks, 0);
  assert.deepEqual(result.value, { count: 1 });
  assert.doesNotMatch(JSON.stringify(result.content), /TIMEOUT|AUTO_REVIEW_FAILED/);
});
test('real Tools + HotEngine exhaustion fails closed without risk ticket or approval', async t => {
  const f = await fixture(t, { missingEngine: true, logReview: true });
  let requests = 0;
  f.ctx.provide('llm', { stream() { requests++; return retryTimeout(); } });
  await f.load(HotEngine);
  const result = await f.run();
  assert.equal(result.isError, true); assert.equal(result.error.info.code, 'AUTO_REVIEW_FAILED');
  assert.match(result.error.message, /4 attempts; 3 retries/); assert.doesNotMatch(result.error.message, /risk_ticket=/);
  assert.equal(requests, 4); assert.equal(f.state.bodies, 0); assert.equal(f.state.asks, 0);
});
test('real HotEngine cancels during retry backoff without another request or body', async t => {
  const f = await fixture(t, { missingEngine: true, logReview: true });
  const controller = new AbortController(), entered = Promise.withResolvers(); let requests = 0;
  f.ctx.provide('llm', { stream() { requests++; entered.resolve(); return retryTimeout(); } });
  await f.load(HotEngine);
  const pending = f.run('inert', {}, controller.signal);
  await entered.promise; await nextTurn(); controller.abort(new Error('test cancelled'));
  const result = await pending;
  assert.equal(result.isError, true); assert.equal(requests, 1);
  assert.equal(f.state.bodies, 0); assert.equal(f.state.asks, 0);
});
test('real HotEngine disposal drains backoff; a replacement keeps guard and cannot revive the old call', async t => {
  const f = await fixture(t, { missingEngine: true, logReview: true });
  const entered = Promise.withResolvers(); let requests = 0, recovered = false;
  f.ctx.provide('llm', { stream() { requests++; entered.resolve(); return recovered ? retryAnswer() : retryTimeout(); } });
  const engineFiber = await f.load(HotEngine);
  const oldEngine = f.ctx.get('riskFirstHotEngine'), guardId = f.ctx.get('riskFirstHotGuard').guardId;
  const pending = f.run(); await entered.promise; await nextTurn();
  await engineFiber.dispose();
  assert.equal((await pending).isError, true); assert.equal(requests, 1);
  assert.equal(oldEngine.ready, false); assert.equal(f.state.bodies, 0);
  recovered = true; await f.load(HotEngine);
  assert.notEqual(f.ctx.get('riskFirstHotEngine').generation, oldEngine.generation);
  assert.equal(f.ctx.get('riskFirstHotGuard').guardId, guardId);
  assert.equal((await f.run()).isError, false); assert.equal(requests, 2);
  assert.equal(f.state.bodies, 1); assert.equal(f.state.asks, 0); assert.equal(f.state.mode, 'auto');
});
test('context changes during a real reviewer retry prevent stale execution', async t => {
  const f = await fixture(t, { missingEngine: true, logReview: true });
  let requests = 0;
  f.ctx.provide('llm', { stream() {
    if (++requests === 1) {
      f.session.append('user/message', { source: { kind: 'user', rpcId: 'changed-task' }, content: [{ type: 'text', text: 'Stop the previous action' }] });
      return retryTimeout();
    }
    return retryAnswer();
  } });
  await f.load(HotEngine);
  const result = await f.run();
  assert.equal(result.isError, true); assert.equal(result.error.info.code, 'AUTO_REVIEW_CONTEXT_CHANGED');
  assert.equal(requests, 2); assert.equal(f.state.bodies, 0); assert.equal(f.state.asks, 0);
});

test('actual owner removal confines Auto rather than enabling Full access and preserves never', async t => {
  const f = await fixture(t, { includeSession: true, approval: 'never' });
  await f.guard.dispose();
  assert.deepEqual(f.events.filter(e => e.type === 'sandbox/mode').map(e => e.data.mode), ['read-only']);
  assert.deepEqual(f.events.filter(e => e.type === 'approval/policy').map(e => e.data.policy), ['never']);
  assert.equal(f.state.mode, 'custom'); assert.equal(f.state.contributions, 0);
});
