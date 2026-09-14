import 'server-only';
import { MongoClient } from 'mongodb';
import type { Subscriber } from './signup';

type Connection = { client: MongoClient; ready: Promise<MongoClient> };
const pool = globalThis as typeof globalThis & { elementaMongo?: Connection };

async function database() {
  if (!pool.elementaMongo) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('Signup unavailable');
    const client = new MongoClient(uri, {
      ...(process.env.MONGODB_AUTH_SOURCE ? { authSource: process.env.MONGODB_AUTH_SOURCE } : {}),
      maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000, socketTimeoutMS: 5000, waitQueueTimeoutMS: 3000,
    });
    const connection = { client, ready: client.connect() };
    pool.elementaMongo = connection;
    connection.ready.catch(async () => {
      if (pool.elementaMongo === connection) delete pool.elementaMongo;
      await client.close().catch(() => {});
    });
  }
  return (await pool.elementaMongo.ready).db('elementa');
}

export async function saveSubscriber(subscriber: Subscriber): Promise<boolean> {
  const collection = (await database()).collection<Subscriber & { _id: string }>('subscribers');
  const filter = { _id: subscriber.email };
  const update = { $setOnInsert: subscriber };
  const options = { upsert: true, writeConcern: { w: 'majority' as const, wtimeoutMS: 5000 }, maxTimeMS: 5000 };
  try {
    return (await collection.updateOne(filter, update, options)).acknowledged;
  } catch (error) {
    // A simultaneous first signup may win the unique _id insert race. Require
    // our own acknowledged match instead of treating every duplicate as success.
    if (!(error instanceof Error) || !('code' in error) || error.code !== 11000) throw error;
    const result = await collection.updateOne(filter, update, { ...options, upsert: false });
    return result.acknowledged && result.matchedCount === 1;
  }
}
