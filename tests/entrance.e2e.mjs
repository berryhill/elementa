import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3118';
const output = process.env.SCREENSHOT_DIR;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const foreground = page => page.evaluate(() => [...document.querySelectorAll('.composition > *, h1, #logo, #emblem, #countdown, .digit')].map(e => {
  const s = getComputedStyle(e), r = e.getBoundingClientRect();
  return { opacity: s.opacity, filter: s.filter, transform: s.transform, x: r.x, y: r.y, width: r.width, height: r.height };
}));
const background = page => page.locator('#coast').evaluate(e => ({ filter: getComputedStyle(e).filter, opacity: +getComputedStyle(e).opacity }));
async function context(options = {}, failure = false) {
  const c = await browser.newContext(options);
  await c.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await c.addInitScript(fail => {
    window.arrivals = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      if (fail) throw Error('simulated unavailable animation');
      const a = animate.call(this, frames, options);
      // Hold the real browser animation for deterministic computed-style sampling.
      a.pause(); a.currentTime = 0;
      window.arrivals.push({ target: this.id, frames, options, a });
      return a;
    };
  }, failure);
  return c;
}
async function staticBackground(page) {
  assert.deepEqual(await background(page), { filter: 'none', opacity: 1 });
  assert((await foreground(page)).every(e => e.opacity === '1' && e.filter === 'none'));
}
try {
  for (const lang of ['es', 'en']) for (const [width, height] of [[1440, 900], [390, 844]]) {
    const c = await context({ viewport: { width, height } });
    let release; const gate = new Promise(resolve => { release = resolve; });
    await c.route('**/_next/**/*.js', async r => { await gate; await r.continue(); });
    const page = await c.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/${lang}`, { waitUntil: 'commit' });
    await page.locator('.composition').waitFor();
    await page.waitForFunction(() => [...document.images].every(i => i.complete));
    await staticBackground(page);
    const before = await foreground(page);
    release(); await page.waitForFunction(() => window.arrivals.length === 1);
    assert.equal(await page.evaluate(() => window.arrivals[0].target), 'coast');
    const samples = [];
    for (const time of [0, 240, 600, 1000, 1200, 1600]) {
      await page.evaluate(t => { window.arrivals[0].a.currentTime = t; }, time);
      assert.deepEqual(await foreground(page), before);
      const s = await background(page);
      samples.push({ time, ...s, blur: s.filter === 'none' ? 0 : parseFloat(s.filter.slice(5)) });
      assert.equal(await page.locator('.tide').evaluate(e => getComputedStyle(e).opacity), '0.3');
      if (output && [0, 600, 1600].includes(time)) await page.screenshot({ path: `${output}/focus-${lang}-${width}-${time}.png` });
    }
    assert.equal(samples[0].blur, 3); assert.equal(samples[0].opacity, .85);
    for (let i = 1; i < samples.length; i++) {
      assert(samples[i].blur <= samples[i - 1].blur);
      assert(samples[i].opacity >= samples[i - 1].opacity);
    }
    assert.equal(samples.at(-1).blur, 0); assert.equal(samples.at(-1).opacity, 1);
    // Let the real animation finish and observe actual countdown ticks, not just API calls.
    await page.evaluate(() => { window.arrivals[0].a.currentTime = 0; window.arrivals[0].a.play(); });
    await page.waitForFunction(() => window.arrivals[0].a.playState === 'finished');
    const digits = await page.locator('#countdown').innerText();
    await page.waitForTimeout(1300);
    assert.notEqual(await page.locator('#countdown').innerText(), digits);
    assert.equal(await page.evaluate(() => window.arrivals.length), 1);
    await staticBackground(page);
    assert.equal(await page.locator('#photo-credit, footer, #motion, #motion-slot').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ lang, width, samples, delayedHydration: 'stable', countdown: 'ticks without replay' }));
    await c.close();

    for (const mode of ['reduce', 'runtime', 'pause', 'no-js', 'failure']) {
      const fallback = await context({ viewport: { width, height }, reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference', javaScriptEnabled: mode !== 'no-js' }, mode === 'failure');
      const p = await fallback.newPage(); await p.goto(`${base}/${lang}`);
      if (['runtime', 'pause'].includes(mode)) {
        await p.waitForFunction(() => window.arrivals.length === 1);
        await p.evaluate(() => { window.arrivals[0].a.currentTime = 300; });
        assert((await background(p)).opacity < 1);
        if (mode === 'runtime') await p.emulateMedia({ reducedMotion: 'reduce' });
        else await p.evaluate(() => document.body.classList.add('no-motion'));
        await p.waitForFunction(() => window.arrivals[0].a.playState === 'idle');
        await staticBackground(p);
        if (mode === 'runtime') await p.emulateMedia({ reducedMotion: 'no-preference' });
        else await p.evaluate(() => document.body.classList.remove('no-motion'));
        await p.waitForTimeout(1300);
        assert.equal(await p.evaluate(() => window.arrivals.length), 1);
      } else if (mode !== 'no-js') {
        await p.locator('body.motion-enabled, body.no-motion').waitFor();
        if (mode === 'reduce') { await p.emulateMedia({ reducedMotion: 'no-preference' }); await p.waitForTimeout(100); }
        assert.equal(await p.evaluate(() => window.arrivals.length), 0);
      }
      await staticBackground(p);
      console.log(`PASS ${lang} ${width} ${mode}`); await fallback.close();
    }
  }
} finally { await browser.close(); }
