import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3142';
const phase = process.env.SCREENSHOT_PHASE || 'after';
const output = resolve(process.env.EVIDENCE_DIR || 'docs/verification/modal-style');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const results = [];
try {
  for (const lang of ['en', 'es']) for (const [width, height] of [[1440,1000],[390,844],[320,568],[844,390]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    // Never send synthetic pageviews, subscriber data, or other off-origin traffic.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/${lang}`);
    await expect(page.locator('#email-open')).toBeEnabled();
    await page.screenshot({ path: `${output}/${phase}-${lang}-${width}x${height}-landing.png`, fullPage: true });
    await page.locator('#email-open').focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('#email-dialog');
    const email = page.locator('#email-address');
    await expect(email).toBeFocused();
    await page.screenshot({ path: `${output}/${phase}-${lang}-${width}x${height}-modal.png`, fullPage: true });
    const styles = await dialog.evaluate(el => {
      const s = getComputedStyle(el), title = getComputedStyle(el.querySelector('h2'));
      return { background: s.backgroundColor, color: s.color, titleFont: title.fontFamily, titleColor: title.color, radius: s.borderRadius, overflow: el.scrollWidth > el.clientWidth, width: el.getBoundingClientRect().width };
    });
    assert.equal(styles.overflow, false);
    assert(styles.width <= width - 30);
    if (phase !== 'before') {
      assert.equal(styles.background, 'rgb(6, 7, 7)');
      assert.equal(styles.color, 'rgb(235, 218, 194)');
      assert.match(styles.titleFont, /Trebuchet/);
      assert.equal(styles.titleColor, styles.color);
      assert.equal(styles.radius, '2px');
    }
    // Native dialog focus containment in both directions, and visible focus styling.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      assert(await dialog.evaluate(el => el.contains(document.activeElement) || document.activeElement === document.body));
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      assert(await dialog.evaluate(el => el.contains(document.activeElement) || document.activeElement === document.body));
    }
    await email.focus();
    assert.equal(await email.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    const axe = await new AxeBuilder({ page }).include('#email-dialog').analyze();
    assert.deepEqual(axe.violations.map(v => ({ id: v.id, impact: v.impact })), []);
    await page.locator('.email-submit').click();
    assert(await email.evaluate(el => el.validity.valueMissing));
    await email.fill('qa@example.invalid');
    await page.locator('.email-submit').click();
    assert(await page.locator('input[name=consent]').evaluate(el => el.validity.valueMissing));
    await page.locator('input[name=consent]').check();
    let payload;
    await page.route('**/api/signup', route => {
      payload = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.locator('.email-submit').click();
    await expect(dialog.locator('.email-success #email-title')).toContainText(lang === 'es' ? 'Te hemos añadido a nuestra lista de correo' : 'You have been added to our mailing list');
    assert.deepEqual(payload, { email: 'qa@example.invalid', locale: lang, consent: true });
    await expect(dialog.locator('form')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#email-open')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.locator('.email-close').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#email-open')).toBeFocused();
    assert.deepEqual(errors, []);
    results.push({ lang, width, height, styles, keyboard: 'pass', axe: 'zero violations', submission: 'mocked success', errors });
    console.log(`PASS ${phase} ${lang} ${width}x${height}`);
    await context.close();
  }
  await writeFile(`${output}/${phase}-results.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
