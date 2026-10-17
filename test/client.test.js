import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('client formatting preserves both reason paragraphs and removes only its own style on disposal', () => {
  let module, style, dispose;
  const document = {
    createElement: name => { assert.equal(name, 'style'); return { dataset: {}, remove() { this.removed = true; } }; },
    head: { appendChild(value) { style = value; } },
  };
  vm.runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    document, window: { __ModuleLoader__: { load(value) { module = value; } } },
  });
  assert.equal(module.id, 'dsh-risk-first-approval');
  // The card half only needs the React hooks to exist for the formatting path;
  // the browser loader provides the real implementation.
  const reactStub = { useState: () => {}, useEffect: () => {}, useCallback: () => {}, useSyncExternalStore: () => {}, createElement: () => {} };
  const client = module.factory(name => { assert.equal(name, 'react'); return reactStub; });
  const contributed = [];
  const calls = [];
  const groups = [{
    id: 'commandcode',
    models: [{ id: 'deepseek/deepseek-v4.1-flash', reasoning: { defaultEffort: 'high', efforts: [{ id: 'low' }, { id: 'high' }] } }],
  }];
  const remote = { session: { modelCatalog: async () => { calls.push('modelCatalog'); return { ok: true, value: { groups, failures: [] } }; } } };
  client.apply({ effect(callback) { const d = callback(); if (typeof d === 'function') dispose = d; }, locale: { register() {} },
    configForms: { get() { return undefined; } },
    remote,
    slots: { inject(_slot, register) { contributed.push(register()); }, register: value => value } });
  assert.equal(style.dataset.plugin, 'dsh-risk-first-approval');
  assert.match(style.textContent, /\[data-approval-scroll\]/);
  assert.match(style.textContent, /white-space: pre-wrap/);
  assert.equal(contributed.length, 1);
  assert.equal(contributed[0].id, 'risk-first-approval');
  // The dropdown catalog is served by the Host over remote.session, not by the
  // session-scoped modelDirectories client service (unreachable from a dynamic
  // plugin's guarded ctx).
  const models = contributed[0].inject().models;
  assert.equal(typeof models.load, 'function');
  assert.equal(typeof models.reasoningFor, 'function');
  return models.load().then(value => {
    assert.deepEqual(value, { groups, failures: [] });
    assert.deepEqual(calls, ['modelCatalog']);
    assert.deepEqual(models.reasoningFor({ provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash' }), { defaultEffort: 'high', efforts: [{ id: 'low' }, { id: 'high' }] });
    assert.equal(models.reasoningFor({ provider: 'zai-coding-cn', model: 'glm-5.3' }), undefined);
    dispose(); assert.equal(style.removed, true);
  });
});

test('catalog load surfaces a host error instead of resolving empty groups', () => {
  let module;
  const document = { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } };
  vm.runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    document, window: { __ModuleLoader__: { load(value) { module = value; } } },
  });
  const reactStub = { useState: () => {}, useEffect: () => {}, useCallback: () => {}, useSyncExternalStore: () => {}, createElement: () => {} };
  const client = module.factory(() => reactStub);
  const contributed = [];
  const remote = { session: { modelCatalog: async () => ({ ok: false, error: { code: 'test/code', message: 'boom' } }) } };
  client.apply({ effect(callback) { callback(); }, locale: { register() {} },
    configForms: { get() { return undefined; } },
    remote,
    slots: { inject(_slot, register) { contributed.push(register()); }, register: value => value } });
  return contributed[0].inject().models.load().then(
    () => { throw new Error('expected load to reject'); },
    error => { assert.match(String(error.message), /test\/code: boom/); },
  );
});
