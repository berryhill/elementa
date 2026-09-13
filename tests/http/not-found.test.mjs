import test from 'node:test';
import assert from 'node:assert/strict';

// Read-only HTTP regression suite against an explicitly selected running preview.
// Run separately from unit tests, after rebuilding the application:
// ELEMENTA_TEST_ORIGIN=http://localhost:3107 node --test tests/http/not-found.test.mjs
// fetch never executes scripts: recovery UI/metadata must be in raw HTML.
const origin = process.env.ELEMENTA_TEST_ORIGIN;
if (!origin) throw new Error('Set ELEMENTA_TEST_ORIGIN to the running preview to test');
const agents = {
  browser: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  social: 'Twitterbot/1.0',
};
const errors = [
  ['/fr', 'es'], ['/fr/credits', 'es'], ['/ES', 'es'], ['/ES/credits', 'es'],
  ['/EN', 'es'], ['/english', 'es'], ['/fr/unknown/nested', 'es'],
  ['/es/unknown', 'es'], ['/es/unknown/nested', 'es'],
  ['/en/unknown', 'en'], ['/en/credits/unknown', 'en'],
];
for (const [agent, userAgent] of Object.entries(agents)) {
  for (const [path, lang] of errors) test(`${agent}: ${path} is a complete unhydrated 404`, async () => {
    const response = await fetch(new URL(path, origin), {
      redirect: 'manual', headers: {'user-agent': userAgent, 'x-elementa-locale': 'en'},
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('location'), null);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const html = await response.text();
    // Exclude serialized React payloads: inspect actual document markup only.
    const document = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    assert.doesNotMatch(document, /__next_error__/);
    assert.match(document, new RegExp(`<html\\b[^>]*lang="${lang}"`));
    const titles = [...document.matchAll(/<title\b[^>]*>([^<]+)<\/title>/g)];
    assert.equal(titles.length, 1);
    assert.match(titles[0][1], /ELEMENTA.*404/);
    assert.match(document, /<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/);
    assert.match(document, /<h1\b[^>]*>404<\/h1>/);
    assert.match(document, /Página no encontrada · Page not found/);
    for (const locale of ['es', 'en']) assert.match(document, new RegExp(`<a\\b[^>]*href="/${locale}"[^>]*>[^<]+<\\/a>`));
    assert.doesNotMatch(document, /rel="canonical"|href[lL]ang=|application\/ld\+json/);
  });
  for (const path of ['/es', '/en', '/es/credits', '/en/credits']) test(`${agent}: ${path} retains its normal page`, async () => {
    const response = await fetch(new URL(path, origin), {redirect: 'manual', headers: {'user-agent': userAgent}});
    assert.equal(response.status, 200);
    const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    assert.match(html, new RegExp(`<html\\b[^>]*lang="${path.split('/')[1]}"`));
    const titles = [...html.matchAll(/<title\b[^>]*>([^<]+)<\/title>/g)];
    assert.equal(titles.length, 1);
    assert.match(titles[0][1], /ELEMENTA/);
    assert.doesNotMatch(titles[0][1], /404|Page not found|Página no encontrada/);
    assert.doesNotMatch(html, /__next_error__/);
  });
}
