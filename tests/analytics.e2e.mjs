import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3117';
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const scripts = [];
  const blocked = [];
  // Never execute Google's library or transmit test traffic. This proves our
  // integration/queue contract, not property-side Enhanced Measurement settings.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
      scripts.push(route.request().url());
      // Next/React may preload the script with an origin-only Referer.
      assert.doesNotMatch(route.request().headers().referer || '', /[?#]|email|secret/);
      return route.fulfill({ contentType: 'application/javascript', body: 'window.__gaMockLoaded = true;' });
    }
    if (url.origin !== new URL(baseURL).origin) { blocked.push(url.href); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const locale of ['es', 'en']) {
    const response = await page.goto(`${baseURL}/${locale}?email=private%40example.org#secret`, { referer: 'https://example.org/?email=referrer-secret' });
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => window.__gaMockLoaded && window.dataLayer?.length >= 5);
    assert.equal(await page.locator('html').getAttribute('lang'), locale);
    assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
    assert.equal(await page.locator('script[src*="googletagmanager.com/gtag/js"]').count(), 1);
    const script = page.locator('script[src*="googletagmanager.com/gtag/js"]');
    assert.equal(await script.getAttribute('data-nscript'), 'afterInteractive');
    assert.equal(await script.evaluate(node => node.async), true);
    await page.locator('#email-open').click();
    await page.locator('input[type="email"]').fill('subscriber-secret@example.org');
    await page.locator('.email-close').click();
    await page.evaluate(() => history.pushState({}, '', '?email=changed-secret#fragment'));
    await page.waitForTimeout(300);
    let calls = await page.evaluate(() => window.dataLayer.map(args => Array.from(args)));
    assert.equal(calls.filter(call => call[0] === 'config').length, 1);
    assert.equal(calls.find(call => call[0] === 'config')[2].send_page_view, false);
    assert.equal(calls.filter(call => call[0] === 'event').length, 1);
    assert.equal(calls.find(call => call[0] === 'event')[2].page_location, `${baseURL}/${locale}`);
    // Native history integration exercises the mounted App Router pathname hook
    // without a new document (normal locale links also work as full navigations).
    await page.evaluate(locale => history.pushState({}, '', `/${locale}/credits?email=route-secret`), locale);
    await page.waitForFunction(() => window.dataLayer.filter(args => args[0] === 'event').length === 2);
    await page.evaluate(locale => history.pushState({}, '', `/${locale}`), locale);
    await page.waitForFunction(() => window.dataLayer.filter(args => args[0] === 'event').length === 3);
    calls = await page.evaluate(() => window.dataLayer.map(args => Array.from(args)));
    assert.doesNotMatch(JSON.stringify(calls), /secret|subscriber|email|[?#]/);
    assert.deepEqual(calls.filter(call => call[0] === 'event').map(call => call[2].page_path), [`/${locale}`, `/${locale}/credits`, `/${locale}`]);
    assert.equal(calls.filter(call => call[0] === 'config').length, 1);
  }
  for (const path of ['/es/credits', '/en/credits']) {
    await page.goto(`${baseURL}${path}?email=secret`);
    await page.waitForFunction(() => window.__gaMockLoaded);
    const views = await page.evaluate(() => window.dataLayer.filter(args => args[0] === 'event').map(args => args[2]));
    assert.equal(views.length, 1);
    assert.equal(views[0].page_path, path);
  }
  const scriptCount = scripts.length;
  assert.equal((await page.goto(`${baseURL}/en/unknown?email=secret`)).status(), 404);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.dataLayer), undefined);
  assert.equal(scripts.length, scriptCount);
  assert(scripts.every(url => url === 'https://www.googletagmanager.com/gtag/js?id=G-D6NRX54EQP'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', mockedScriptLoads: scripts.length, blockedExternalRequests: blocked.length, pageErrors: errors, checks: 'both locales, credits, SPA navigation/revisits, query deduplication, PII exclusion, async afterInteractive, noindex, 404' }));
} finally { await browser.close(); }
