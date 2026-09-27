import dotenv from "dotenv";
import { Db, MongoClient, ObjectId } from "mongodb";

// Loads .env into process.env. First module in the require chain that needs env vars.
dotenv.config();

// Talks to Atlas directly with the normal driver (one pooled connection per process).
// This used to go through db-proxy over HTTPS because the old cPanel host blocked Mongo's
// port; Render doesn't, so the extra hop is gone. The exported functions keep the exact
// shapes the db-proxy version had, so routes and tests didn't change.
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE = process.env.MONGODB_DATABASE ?? "occubuy";

// fail fast instead of hanging a renter's request when Atlas is unreachable
const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 10_000;

export const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

let client: MongoClient | null = null;
let dbPromise: Promise<Db> | null = null;

// Connects on first use, so scripts and the server share the same code path. server.ts
// calls it at startup too, so a bad MONGODB_URI stops the deploy instead of the first request.
export function connectDb(): Promise<Db> {
  if (!dbPromise) {
    if (!MONGODB_URI) {
      return Promise.reject(new Error("MONGODB_URI must be set - see backend/.env.example"));
    }
    try {
      client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
        connectTimeoutMS: CONNECT_TIMEOUT_MS,
      });
    } catch (err) {
      // a malformed URI throws here, before there's a promise to reject
      return Promise.reject(err);
    }
    dbPromise = client
      .connect()
      .then((connected) => connected.db(DATABASE))
      .catch((err) => {
        // let the next call try again instead of caching the failure
        dbPromise = null;
        client = null;
        throw err;
      });
  }
  return dbPromise;
}

export async function closeDb(): Promise<void> {
  const current = client;
  client = null;
  dbPromise = null;
  if (current) await current.close();
}

// Everything used to cross HTTP as JSON, so Dates were stored as ISO strings and any
// ObjectId came back as a string. Doing the same round trip here keeps the stored data and
// what callers get back exactly as before.
function toPlain<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

// Filters use { _id: { $oid } } (the old Data API shape) or a plain id string; both become
// a real ObjectId. Only a top-level _id is converted, same as db-proxy did.
function resolveFilter(filter: Record<string, unknown>): Record<string, unknown> {
  const plain = toPlain(filter);
  const id = plain._id;
  if (typeof id === "string" && OBJECT_ID_RE.test(id)) {
    return { ...plain, _id: new ObjectId(id) };
  }
  if (id && typeof id === "object" && "$oid" in (id as Record<string, unknown>)) {
    return { ...plain, _id: new ObjectId((id as { $oid: string }).$oid) };
  }
  return plain;
}

function serializeDoc<T>(doc: Record<string, unknown> | null): (T & { _id: string }) | null {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...(toPlain(rest) as T), _id: String(_id) };
}

export async function findOne<T>(
  collection: string,
  filter: Record<string, unknown>
): Promise<(T & { _id: string }) | null> {
  const db = await connectDb();
  const doc = await db
    .collection(collection)
    .findOne(resolveFilter(filter), { maxTimeMS: QUERY_TIMEOUT_MS });
  return serializeDoc<T>(doc);
}

export async function findById<T>(
  collection: string,
  id: string
): Promise<(T & { _id: string }) | null> {
  if (!OBJECT_ID_RE.test(id)) return null;
  return findOne<T>(collection, { _id: id });
}

export async function insertOne(
  collection: string,
  document: Record<string, unknown>
): Promise<string> {
  const db = await connectDb();
  const result = await db.collection(collection).insertOne(toPlain(document));
  return result.insertedId.toString();
}

// Raw updateOne: any filter + any update operators ($inc, $set...), applied atomically by Mongo.
// Use this when "check and change" has to be one step, e.g. only bump a counter while it's
// still under a limit - matchedCount 0 means the condition didn't hold (or nothing matched).
// An _id in the filter is passed as a plain id string and converted here.
export async function updateOne(
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>
): Promise<{ matchedCount: number; modifiedCount: number }> {
  const db = await connectDb();
  const result = await db
    .collection(collection)
    .updateOne(resolveFilter(filter), toPlain(update), { maxTimeMS: QUERY_TIMEOUT_MS });
  return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
}

export async function updateById(
  collection: string,
  id: string,
  update: Record<string, unknown>
): Promise<void> {
  await updateOne(collection, { _id: id }, { $set: update });
}
