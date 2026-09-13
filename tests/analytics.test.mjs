import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../src/lib/analytics.ts', import.meta.url), 'utf8');
const javascript = stripTypeScriptTypes(source).replace("'./localization'", JSON.stringify(new URL('../src/lib/localization.ts', import.meta.url).href));
const { analyticsPage, createPageTracker, initializeAnalytics, measurementId } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);

test('analytics only exposes allowlisted page context, never query/fragment/referrer data', () => {
  for (const locale of ['en', 'es']) for (const suffix of ['', '/credits']) {
    const page = analyticsPage(`/${locale}${suffix}?email=private@example.org#token`, 'https://example.org');
    assert.equal(page.page_path, `/${locale}${suffix}`);
    assert.equal(page.page_location, `https://example.org/${locale}${suffix}`);
    assert.equal(page.content_language, locale);
    assert.equal(page.page_referrer, '');
    assert.doesNotMatch(JSON.stringify(page), /private|email|token|[?#]/);
  }
  for (const path of ['/en/private@example.org', '/api/signup', '/fr', '/404', '/']) assert.equal(analyticsPage(path, 'https://example.org'), null);
});

test('config disables automatic initial pageviews and advertising signals before manual view', () => {
  const calls = [];
  const gtag = (...args) => calls.push(args);
  initializeAnalytics(gtag, '/es?email=private', 'https://example.org');
  createPageTracker(gtag, 'https://example.org')('/es');
  assert.deepEqual(calls.map(call => call[0]), ['js', 'set', 'config', 'set', 'event']);
  assert.equal(measurementId, 'G-D6NRX54EQP');
  assert.equal(calls[2][1], measurementId);
  assert.equal(calls[2][2].send_page_view, false);
  assert.equal(calls[2][2].allow_google_signals, false);
  assert.equal(calls[2][2].allow_ad_personalization_signals, false);
  assert.equal(calls[4][2].send_to, measurementId);
});

test('rerenders, query-only changes and fragments do not duplicate pageviews; revisits do', () => {
  const calls = [];
  const track = createPageTracker((...args) => calls.push(args), 'https://example.org');
  for (const path of ['/en', '/en', '/en?email=private', '/en#signup', '/es', '/es/credits', '/en', '/en/unknown', '/en']) track(path);
  assert.deepEqual(calls.filter(call => call[0] === 'event').map(call => call[2].page_path), ['/en', '/es', '/es/credits', '/en', '/en']);
  assert.doesNotMatch(JSON.stringify(calls), /private|unknown|signup/);
});

test('unknown pages do not initialize analytics', () => {
  const calls = [];
  initializeAnalytics((...args) => calls.push(args), '/en/private', 'https://example.org');
  assert.deepEqual(calls, []);
});
