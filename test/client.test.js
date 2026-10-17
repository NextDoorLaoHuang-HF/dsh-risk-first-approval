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
  const modelDirectories = { load: async () => ({ groups: [] }), reasoningFor: () => undefined };
  client.apply({ effect(callback) { const d = callback(); if (typeof d === 'function') dispose = d; }, locale: { register() {} },
    configForms: { get() { return undefined; } },
    modelDirectories,
    slots: { inject(_slot, register) { contributed.push(register()); }, register: value => value } });
  assert.equal(style.dataset.plugin, 'dsh-risk-first-approval');
  assert.match(style.textContent, /\[data-approval-scroll\]/);
  assert.match(style.textContent, /white-space: pre-wrap/);
  assert.equal(contributed.length, 1);
  assert.equal(contributed[0].id, 'risk-first-approval');
  assert.equal(contributed[0].inject().models, modelDirectories);
  dispose(); assert.equal(style.removed, true);
});
