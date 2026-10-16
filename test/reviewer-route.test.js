import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewerRouteConfig, resolveReviewerRoute } from '../src/reviewer-route.js';
import { classifyRisk } from '../src/upstream-review.js';

function nativeFixture() {
  const schema = { name: 'bash', description: 'Execute a command', parameters: { type: 'object' } };
  const args = { command: 'inspect project' };
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId: 'human-1' }, content: [{ type: 'text', text: 'Inspect the project.' }] } },
    { seq: 3, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [
      { type: 'tool-call', id: 'c1', name: 'bash', arguments: JSON.stringify(args) },
    ] } } },
    { seq: 4, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: JSON.stringify(args) } },
  ];
  const header = { config: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'high' }, tools: [schema] };
  const agent = { session: { header: { cwd: '/project' }, surface: { nodes: [2, 3] },
    snapshotEvents: () => events, requestHeader: () => header, isOwnSeq: () => true } };
  const exec = { agent, name: 'bash', arguments: args, callId: 'c1', rootCallId: 'c1', signal: new AbortController().signal };
  return { agent, exec, header };
}
async function* stream(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

test('route config defaults resolve to no dedicated route', () => {
  const config = ReviewerRouteConfig({});
  assert.equal(resolveReviewerRoute(config), undefined);
  assert.equal(resolveReviewerRoute({}), undefined);
  assert.equal(resolveReviewerRoute(undefined), undefined);
});

test('route config builds a frozen dedicated route', () => {
  const route = resolveReviewerRoute({ reviewerProvider: 'zai-coding-cn', reviewerModel: 'glm-5.3-flash', reviewerReasoningEffort: 'low' });
  assert.deepEqual(route, { provider: 'zai-coding-cn', model: 'glm-5.3-flash', reasoningEffort: 'low' });
  assert.ok(Object.isFrozen(route));
  const bare = resolveReviewerRoute({ reviewerProvider: ' zai-coding-cn ', reviewerModel: ' glm-5.3-flash ' });
  assert.deepEqual(bare, { provider: 'zai-coding-cn', model: 'glm-5.3-flash' });
});

test('half-set or effort-only route config fails closed with guidance', () => {
  assert.throws(() => resolveReviewerRoute({ reviewerProvider: 'zai-coding-cn' }), /must be set together/);
  assert.throws(() => resolveReviewerRoute({ reviewerModel: 'glm-5.3-flash' }), /must be set together/);
  assert.throws(() => resolveReviewerRoute({ reviewerReasoningEffort: 'low' }), /requires reviewerProvider/);
});

test('classifyRisk sends the review to the configured route and effort', async () => {
  const f = nativeFixture(); let captured; let infoCalls = 0;
  const ctx = { llm: {
    async resolveModelInfo(provider, model) {
      infoCalls++;
      assert.equal(provider, 'zai-coding-cn'); assert.equal(model, 'glm-5.3-flash');
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } };
    },
    stream(options) { captured = options; return stream('{"risk":"low","decision":"allow"}'); },
  } };
  const route = Object.freeze({ provider: 'zai-coding-cn', model: 'glm-5.3-flash', reasoningEffort: 'low' });
  const result = await classifyRisk(ctx, f.agent, f.exec, f.exec.signal, route);
  assert.equal(result.decision, 'allow');
  assert.equal(captured.provider, 'zai-coding-cn');
  assert.equal(captured.model, 'glm-5.3-flash');
  assert.equal(captured.reasoningEffort, 'low');
  assert.equal(infoCalls, 1);
});

test('a configured effort the route model does not offer fails before any request', async () => {
  const f = nativeFixture(); let streamed = 0;
  const ctx = { llm: {
    async resolveModelInfo() { return { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }; },
    stream(options) { streamed++; return stream('{"risk":"low","decision":"allow"}'); },
  } };
  const route = Object.freeze({ provider: 'zai-coding-cn', model: 'glm-5.3-flash', reasoningEffort: 'xhigh' });
  await assert.rejects(classifyRisk(ctx, f.agent, f.exec, f.exec.signal, route), /does not offer reasoning effort "xhigh"/);
  assert.equal(streamed, 0);
});

test('a dedicated route without effort uses the route model automatic effort, not the session effort', async () => {
  const f = nativeFixture(); let captured;
  const ctx = { llm: {
    async resolveModelInfo(provider, model) {
      return { reasoning: { defaultEffort: 'low', efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } };
    },
    stream(options) { captured = options; return stream('{"risk":"low","decision":"allow"}'); },
  } };
  const route = Object.freeze({ provider: 'zai-coding-cn', model: 'glm-5.3-flash' });
  await classifyRisk(ctx, f.agent, f.exec, f.exec.signal, route);
  // Session header carried reasoningEffort 'high' for gpt-6.1-sol; the flash
  // route must resolve its own automatic effort instead of inheriting it.
  assert.equal(captured.provider, 'zai-coding-cn');
  assert.equal(captured.reasoningEffort, 'low');
});

test('no route keeps the historical session-route behavior', async () => {
  const f = nativeFixture(); let captured;
  const ctx = { llm: { stream(options) { captured = options; return stream('{"risk":"low","decision":"allow"}'); } } };
  await classifyRisk(ctx, f.agent, f.exec, f.exec.signal);
  assert.equal(captured.provider, 'openai-codex');
  assert.equal(captured.model, 'gpt-6.1-sol');
  assert.equal(captured.reasoningEffort, 'high');
  await classifyRisk(ctx, f.agent, f.exec, f.exec.signal, undefined);
  assert.equal(captured.model, 'gpt-6.1-sol');
});
