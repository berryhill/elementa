import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

test('explicit auth database overrides URI without changing subscriber database or credentials', async () => {
  const previousUri = process.env.MONGODB_URI;
  const previousSource = process.env.MONGODB_AUTH_SOURCE;
  const options = [];
  const uri = 'mongodb://test:placeholder@mongo.invalid/elementa?authSource=elementa';
  globalThis.__authDriver = class {
    constructor(value, opts) { assert.equal(value, uri); options.push(opts); }
    async connect() { return this; }
    async close() {}
    db(name) {
      assert.equal(name, 'elementa');
      return { collection(name) {
        assert.equal(name, 'subscribers');
        return { async updateOne() { return { acknowledged: true }; } };
      } };
    }
  };
  try {
    process.env.MONGODB_URI = uri;
    const source = stripTypeScriptTypes(await readFile(new URL('../src/lib/subscribers.ts', import.meta.url), 'utf8'))
      .replace("import 'server-only';", '')
      .replace(/import \{ MongoClient \} from 'mongodb';/, 'const MongoClient = globalThis.__authDriver;');
    const { saveSubscriber } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    for (const auth of ['admin', undefined, '']) {
      delete globalThis.elementaMongo;
      if (auth === undefined) delete process.env.MONGODB_AUTH_SOURCE;
      else process.env.MONGODB_AUTH_SOURCE = auth;
      assert.equal(await saveSubscriber({ email:'auth-test@example.invalid',locale:'en',consent:true,consentVersion:'test',createdAt:new Date() }), true);
      assert.equal(options.at(-1).authSource, auth || undefined);
    }
  } finally {
    if (previousUri === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = previousUri;
    if (previousSource === undefined) delete process.env.MONGODB_AUTH_SOURCE; else process.env.MONGODB_AUTH_SOURCE = previousSource;
    delete globalThis.elementaMongo;
    delete globalThis.__authDriver;
  }
});
