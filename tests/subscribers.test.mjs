import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Execute the production repository with a fake driver, not a MongoDB emulator.
// This verifies options and race handling, not real database persistence.
test('Mongo repository: lazy pooled client, fixed namespace, atomic insert-only upsert and duplicate race', async () => {
  const calls = [];
  let clients = 0;
  let behavior = async () => ({ acknowledged: true });
  class MongoClient {
    constructor(uri, options) { clients++; assert.equal(uri, 'test-uri'); assert.equal(options.maxPoolSize, 5); }
    async connect() { return this; }
    async close() {}
    db(name) {
      assert.equal(name, 'elementa');
      return { collection(name) {
        assert.equal(name, 'subscribers');
        return { updateOne(...args) { calls.push(args); return behavior(); } };
      } };
    }
  }
  globalThis.__signupFakeDriver = MongoClient;
  const previous = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  delete globalThis.elementaMongo;
  try {
    const source = stripTypeScriptTypes(await readFile(new URL('../src/lib/subscribers.ts', import.meta.url), 'utf8'))
      .replace("import 'server-only';", '')
      .replace(/import \{ MongoClient \} from 'mongodb';/, 'const MongoClient = globalThis.__signupFakeDriver;');
    const { saveSubscriber } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    assert.equal(clients, 0);
    const subscriber = { email: 'qa@example.invalid', locale: 'en', consent: true, consentVersion: 'elementa-updates-v1', createdAt: new Date() };
    await assert.rejects(saveSubscriber(subscriber), /Signup unavailable/);
    process.env.MONGODB_URI = 'test-uri';
    assert.equal(await saveSubscriber(subscriber), true);
    assert.equal(await saveSubscriber(subscriber), true);
    assert.equal(clients, 1);
    assert.deepEqual(calls[0], [{ _id: subscriber.email }, { $setOnInsert: subscriber }, { upsert: true, writeConcern: { w: 'majority', wtimeoutMS: 5000 }, maxTimeMS: 5000 }]);
    let attempts = 0;
    behavior = async () => {
      if (++attempts === 1) throw Object.assign(new Error('duplicate'), { code: 11000 });
      return { acknowledged: true, matchedCount: 1 };
    };
    assert.equal(await saveSubscriber(subscriber), true);
    assert.equal(calls.at(-1)[2].upsert, false);
    attempts = 0;
    behavior = async () => {
      if (++attempts === 1) throw Object.assign(new Error('duplicate'), { code: 11000 });
      return { acknowledged: true, matchedCount: 0 };
    };
    assert.equal(await saveSubscriber(subscriber), false);
    behavior = async () => ({ acknowledged: false });
    assert.equal(await saveSubscriber(subscriber), false);
    behavior = async () => { throw new Error('database unavailable'); };
    await assert.rejects(saveSubscriber(subscriber), /database unavailable/);
  } finally {
    if (previous === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = previous;
    delete globalThis.elementaMongo;
    delete globalThis.__signupFakeDriver;
  }
});
