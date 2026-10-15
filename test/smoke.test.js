import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSmokeFixture } from '../smoke/fixture.js';
import { snapshotAutoReview } from '../src/upstream-review.js';

test('live smoke fixture uses only public constants, never private session content', () => {
  const f = makeSmokeFixture({ provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'high', private: 'DO_NOT_COPY' }, 'session', new AbortController().signal);
  const snapshot = snapshotAutoReview(f.agent, f.exec);
  assert.equal(snapshot.reasoningEffort, 'high');
  assert.doesNotMatch(JSON.stringify(snapshot), /DO_NOT_COPY/);
  assert.equal(snapshot.action.name, 'return_constant');
  assert.match(snapshot.action.description, /No filesystem, network, subprocess/);
});
test('implicit smoke deliberately exercises missing session effort without changing real settings', () => {
  const original = { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'high' };
  const f = makeSmokeFixture(original, 'implicit', new AbortController().signal);
  assert.equal(Object.hasOwn(f.config, 'reasoningEffort'), false);
  assert.equal(original.reasoningEffort, 'high');
});
