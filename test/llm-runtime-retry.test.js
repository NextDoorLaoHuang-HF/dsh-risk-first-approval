// Isolated loopback acceptance: no live profile, global adapter, credentials,
// user messages or external provider traffic. Exercise the real LlmRuntime's
// adapter-exception -> terminal-finish normalization, then the reviewer retry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { classifyRisk } from '../src/upstream-review.js';
import { makeSmokeFixture } from '../smoke/fixture.js';

async function setup(t, respond) {
  const state = { httpRequests: 0, adapterRequests: 0, requestOptions: [], receivedBodies: [] };
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    state.receivedBodies.push(JSON.parse(body));
    respond(++state.httpRequests, res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const ctx = new Context();
  const fiber = ctx.plugin(LlmRuntime); await fiber.inertia;
  class LoopbackAdapter extends LlmAdapter {
    async resolveModel(provider, id) {
      return { provider, id, name: id, reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } };
    }
    async *stream(options) {
      state.adapterRequests++; state.requestOptions.push(options);
      const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ messages: options.messages }), signal: options.signal });
      const body = await response.text();
      if (!response.ok) throw new LlmError('Isolated HTTP provider failure', response.status === 429 ? 'RATE_LIMIT' : response.status >= 500 ? 'SERVER' : 'AUTH',
        { status: response.status, ...(response.headers.has('retry-after') ? { providerRetryAfterMs: Number(response.headers.get('retry-after')) * 1000 } : {}) });
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: body };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: body } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  const unregister = ctx.llm.registerAdapter(['loopback-only'], new LoopbackAdapter());
  t.after(async () => {
    unregister(); await fiber.dispose();
    server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const signal = AbortSignal.timeout(15_000);
  const fixture = makeSmokeFixture({ provider: 'loopback-only', model: 'synthetic', reasoningEffort: 'low' }, 'session', signal);
  return { ctx, state, fixture, run: () => classifyRisk(ctx, fixture.agent, fixture.exec, signal) };
}
test('loopback HTTP 503 twice -> real LlmRuntime terminal errors -> reviewer recovers third request', async t => {
  const f = await setup(t, (attempt, response) => {
    if (attempt <= 2) { response.writeHead(503, { 'retry-after': '0.02' }); response.end('temporary'); }
    else { response.writeHead(200); response.end('{"risk":"low","decision":"allow"}'); }
  });
  assert.deepEqual(await f.run(), { risk: 'low', decision: 'allow' });
  assert.equal(f.state.httpRequests, 3); assert.equal(f.state.adapterRequests, 3);
  assert.deepEqual(f.state.receivedBodies[0], f.state.receivedBodies[2]);
  assert.ok(f.state.requestOptions.every(options => Object.isFrozen(options)));
});
test('loopback HTTP 429 exhaustion retains structured failure after exactly four requests', async t => {
  const f = await setup(t, (_attempt, response) => { response.writeHead(429, { 'retry-after': '0.02' }); response.end('temporary rate limit'); });
  await assert.rejects(f.run(), error => {
    assert.equal(error.code, 'RATE_LIMIT'); assert.equal(error.attempts, 4);
    assert.equal(error.failure.status, 429); assert.equal(error.failure.providerRetryAfterMs, 20); return true;
  });
  assert.equal(f.state.httpRequests, 4); assert.equal(f.state.adapterRequests, 4);
});
test('loopback HTTP 401 fails closed without retrying authentication', async t => {
  const f = await setup(t, (_attempt, response) => { response.writeHead(401); response.end('unauthorized fixture'); });
  await assert.rejects(f.run(), error => error.code === 'AUTH');
  assert.equal(f.state.httpRequests, 1); assert.equal(f.state.adapterRequests, 1);
});
