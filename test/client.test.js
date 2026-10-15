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
  module.factory().apply({ effect(callback) { dispose = callback(); } });
  assert.equal(style.dataset.plugin, 'dsh-risk-first-approval');
  assert.match(style.textContent, /\[data-approval-scroll\]/);
  assert.match(style.textContent, /white-space: pre-wrap/);
  dispose(); assert.equal(style.removed, true);
});
