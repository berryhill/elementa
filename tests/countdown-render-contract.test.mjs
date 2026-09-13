import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { copy, festival } from '../src/content/festival.ts';
import { countdownValues } from '../src/lib/countdown.ts';

// Source-contract tests, not a substitute for React SSR/browser verification.
const component = await readFile(new URL('../src/components/Countdown.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/app/[lang]/page.tsx', import.meta.url), 'utf8');

test('server route passes its countdown snapshot into the client island', () => {
  assert.match(page, /initialValues=\{countdownValues\(festival\.announcementAt, Date\.now\(\)\)\}/);
  assert.match(component, /useState<string\[\] \| null>\(initialValues\)/);
  assert.doesNotMatch(component, /\['—'/);
});

test('release heading changes with expiry instead of leaving an incomplete release-in label', () => {
  assert.match(component, /values \? t\.countdown : t\.releaseHeading/);
  assert.equal((page + component).match(/id="countdown-label"/g)?.length, 1);
  for (const lang of ['es', 'en']) {
    assert(copy[lang].releaseHeading);
    assert.notEqual(copy[lang].releaseHeading, copy[lang].countdown);
    assert(copy[lang].pending);
  }
});

test('server snapshots are JSON-serializable before and after release', () => {
  const deadline = Date.parse(festival.announcementAt);
  for (const now of [deadline - 1000, deadline, deadline + 1000]) {
    const snapshot = countdownValues(festival.announcementAt, now);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
    if (now >= deadline) assert.equal(snapshot, null);
    else assert.deepEqual(snapshot, ['00', '00', '00', '01']);
  }
});
