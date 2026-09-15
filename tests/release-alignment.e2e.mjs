import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3118';
const browser = await chromium.launch();
try {
  for (const lang of ['en', 'es']) {
    for (const [width, height] of [[320,568],[390,844],[430,932],[600,844],[1440,1000]]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
      await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(`${base}/${lang}`);
      await page.locator('#release-date').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.locator('#release-date time').evaluate(e => {
        const r = e.getBoundingClientRect();
        return { center: r.x + r.width / 2, viewportCenter: innerWidth / 2, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert(Math.abs(geometry.center - geometry.viewportCenter) <= 1, `${lang} ${width}: date center ${geometry.center}, expected ${geometry.viewportCenter}`);
      assert.equal(geometry.overflow, false);
      console.log(`PASS ${lang} ${width}x${height}: centered date, no overflow`);
      await context.close();
    }
  }
} finally { await browser.close(); }
