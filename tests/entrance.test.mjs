import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../src/components/SectionEntrance.tsx', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source.replace("import { useEffect } from 'react';", '').replace('export default ', ''));
function mount({ ready = true, reduced = false, unsupported = false } = {}) {
  const classes = new Set(ready ? ['motion-enabled'] : []);
  const media = { matches: reduced, addEventListener(_, cb) { this.update = cb; }, removeEventListener() {} };
  const calls = []; let cancelled = 0, sync, cleanup;
  const tide = { animate(frames, options) { if (unsupported) throw Error('unsupported'); calls.push({ frames, options }); return { cancel() { cancelled++; } }; } };
  runInNewContext(`${code}; SectionEntrance();`, {
    useEffect(cb) { cleanup = cb(); }, window: { matchMedia: () => media },
    document: { body: { classList: { contains: c => classes.has(c) } }, querySelector(selector) { assert.equal(selector, '.world .tide'); return tide; } },
    MutationObserver: class { constructor(cb) { sync = cb; } observe() {} disconnect() {} },
  });
  return { calls, classes, media, sync, cleanup, cancelled: () => cancelled };
}
test('arrival animates background opacity once, never text or CSS transforms', () => {
  const m = mount(); assert.equal(m.calls.length, 1);
  assert.equal(JSON.stringify(m.calls[0].frames), JSON.stringify([{ opacity: .3, offset: 0 }, { opacity: .42, offset: .4 }, { opacity: .3, offset: 1 }]));
  assert.equal(m.calls[0].options.duration, 1100);
  assert.equal(m.calls[0].options.fill, undefined);
  m.sync(); m.sync(); assert.equal(m.calls.length, 1); m.cleanup(); assert.equal(m.cancelled(), 1);
});
test('waits for hydration readiness; explicit pause cancels with no replay', () => {
  const m = mount({ ready: false }); assert.equal(m.calls.length, 0);
  m.classes.add('motion-enabled'); m.sync(); assert.equal(m.calls.length, 1);
  m.classes.add('no-motion'); m.sync(); assert.equal(m.cancelled(), 1);
  m.classes.delete('no-motion'); m.sync(); assert.equal(m.calls.length, 1);
});
test('initial and runtime reduced motion suppress arrival permanently', () => {
  const initial = mount({ reduced: true }); initial.media.matches = false; initial.media.update(); assert.equal(initial.calls.length, 0);
  const runtime = mount(); runtime.media.matches = true; runtime.media.update(); assert.equal(runtime.cancelled(), 1);
  runtime.media.matches = false; runtime.media.update(); assert.equal(runtime.calls.length, 1);
});
test('unsupported animation leaves static page usable', () => { const m = mount({ unsupported: true }); assert.equal(m.calls.length, 0); m.cleanup(); });
