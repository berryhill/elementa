import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignupHandler, CONSENT_VERSION } from '../src/lib/signup.ts';
const origin = 'https://elementa.example';
const valid = { email: ' Person@Example.com ', locale: 'es', consent: true };
function request(body = valid, headers = {}, method = 'POST') {
  return new Request(origin + '/api/signup', { method,
    headers: { origin, 'content-type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
test('both locales normalized and acknowledged; duplicate retry preserves first record', async () => {
  const records = new Map();
  const handler = createSignupHandler(async record => {
    if (!records.has(record.email)) records.set(record.email, record);
    return true;
  });
  for (const locale of ['es', 'en']) {
    const result = await handler(request({ ...valid, locale }));
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true });
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  assert.equal(records.size, 1);
  const record = records.get('person@example.com');
  assert.equal(record.locale, 'es'); assert.equal(record.consent, true);
  assert.equal(record.consentVersion, CONSENT_VERSION); assert(record.createdAt instanceof Date);
  assert.deepEqual(Object.keys(record).sort(), ['consent', 'consentVersion', 'createdAt', 'email', 'locale']);
});
test('success waits for repository acknowledgement', async () => {
  let resolve; let completed = false;
  const handler = createSignupHandler(() => new Promise(r => { resolve = r; }));
  const pending = handler(request()).then(r => { completed = true; return r; });
  await new Promise(r => setImmediate(r)); assert.equal(completed, false);
  resolve(true); assert.equal((await pending).status, 200);
});
test('database failures and unacknowledged writes are generic errors', async () => {
  for (const save of [async () => false, async () => { throw Error('mongodb://secret person@example.com'); }]) {
    const res = await createSignupHandler(save)(request());
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, error: 'Unable to process signup.' });
  }
});
test('invalid JSON, schema, consent, locale and email never reach repository', async () => {
  const handler = createSignupHandler(async () => { assert.fail('unexpected write'); });
  for (const input of ['{', 'null', '[]', {}, { ...valid, consent: false }, { ...valid, consent: 'true' },
    { ...valid, locale: 'fr' }, { ...valid, extra: true }, { ...valid, email: { $ne: null } },
    ...['', 'a@b', 'a..b@example.com', '.a@example.com', 'a@-example.com', 'a@ex ample.com', 'a\n@example.com', 'x'.repeat(255)].map(email => ({ ...valid, email }))]) {
    assert.equal((await handler(request(input))).status, 400, JSON.stringify(input));
  }
});
test('same-origin JSON POST only; forwarded headers cannot authorize origin', async () => {
  const handler = createSignupHandler(async () => true);
  for (const [headers, status] of [[{ origin: 'https://evil.example' }, 403], [{ origin: 'null' }, 403],
    [{ origin: '' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403], [{ 'content-type': 'text/plain' }, 415],
    [{ origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }, 403]]) {
    assert.equal((await handler(request(valid, headers))).status, status);
  }
  assert.equal((await handler(request(valid, {}, 'GET'))).status, 405);
  assert.equal((await createSignupHandler(async () => true, 'https://public.example')(request(valid, { origin: 'https://public.example' }))).status, 200);
  assert.equal((await createSignupHandler(async () => true, 'invalid')(request())).status, 503);
});
test('2 KiB limit counts actual streamed bytes, not just declared size', async () => {
  const handler = createSignupHandler(async () => true);
  assert.equal((await handler(request(valid, { 'content-length': '2049' }))).status, 413);
  const raw = JSON.stringify(valid);
  assert.equal((await handler(request(raw.padEnd(2048)))).status, 200);
  assert.equal((await handler(request(raw.padEnd(2049)))).status, 413);
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1024)); c.enqueue(new Uint8Array(1025)); }, cancel() { cancelled = true; } });
  const res = await handler(new Request(origin + '/api/signup', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'content-length': '10' }, body, duplex: 'half' }));
  assert.equal(res.status, 413); assert.equal(cancelled, true);
});
