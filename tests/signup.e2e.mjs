import assert from 'node:assert/strict';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('node_modules/.cache/ms-playwright');
const { chromium, expect } = await import('@playwright/test');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3120';
const browser = await chromium.launch();
try {
  for (const lang of ['es', 'en']) {
    const page = await browser.newPage();
    await page.goto(`${base}/${lang}`);
    await page.locator('#email-open').click();
    const email = page.locator('#email-address');
    const submit = page.locator('.email-submit');
    const status = page.locator('#email-dialog [role=status]');
    const error = lang === 'es' ? 'No pudimos confirmar' : 'We could not confirm';
    let held;
    let count = 0;
    await page.route('**/api/signup', route => { count++; held = route; });
    await email.fill('qa@example.invalid');
    await page.locator('input[type=checkbox]').check();
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(email).toBeDisabled();
    await expect.poll(() => count).toBe(1);
    assert.deepEqual(held.request().postDataJSON(), { email: 'qa@example.invalid', locale: lang, consent: true });
    await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(count, 1);
    assert.equal(await status.innerText(), '');
    await held.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
    await expect(status).toContainText(error);
    await expect(email).toHaveValue('qa@example.invalid');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(() => count).toBe(2);
    await held.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    await expect(status).toContainText(lang === 'es' ? 'Tu suscripción está guardada' : 'Your subscription is saved');
    await expect(email).toHaveValue('');
    // A closed request must not overwrite a newly opened dialog.
    await email.fill('old@example.invalid');
    await page.locator('input[type=checkbox]').check();
    await submit.click();
    await expect.poll(() => count).toBe(3);
    const old = held;
    await page.keyboard.press('Escape');
    await expect(page.locator('#email-dialog')).not.toBeVisible();
    await page.locator('#email-open').click();
    await email.fill('new@example.invalid');
    await old.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }).catch(() => {});
    await expect(email).toHaveValue('new@example.invalid');
    await expect(status).toHaveText('');
    // Timeout reports uncertainty and permits a safe idempotent retry.
    await page.clock.install();
    await page.locator('input[type=checkbox]').check();
    await submit.click();
    await expect.poll(() => count).toBe(4);
    await page.clock.fastForward(12001);
    await expect(status).toContainText(error);
    await expect(email).toHaveValue('new@example.invalid');
    await expect(submit).toBeEnabled();
    console.log(`PASS ${lang}: API payload, pending guard, failure/retry/success, close cancellation, timeout`);
    await page.close();
  }
} finally { await browser.close(); }
