import dotenv from "dotenv";

// loads variables from .env into process.env - this is now the first module in the
// require chain that needs env vars, so this is where that happens (used to live in
// config/db.ts before the mongoose driver got replaced with the Data API)
dotenv.config();

// the native mongodb+srv:// driver (port 27017) is blocked outbound on this host, but
// plain HTTPS to Atlas's Data API isn't - see README for the full story. everything here
// talks to that Data API instead of holding a live driver connection.
const BASE_URL = process.env.MONGODB_DATA_API_URL;
const API_KEY = process.env.MONGODB_DATA_API_KEY;
const DATA_SOURCE = process.env.MONGODB_DATA_SOURCE ?? "mongodb-atlas";
const DATABASE = process.env.MONGODB_DATABASE ?? "occubuy";

export const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function ensureConfigured(): void {
  if (!BASE_URL || !API_KEY) {
    throw new Error(
      "MONGODB_DATA_API_URL and MONGODB_DATA_API_KEY must be set - see backend/.env.example"
    );
  }
}

async function callDataApi<T>(action: string, body: Record<string, unknown>): Promise<T> {
  ensureConfigured();
  const res = await fetch(`${BASE_URL}/action/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": API_KEY as string,
    },
    body: JSON.stringify({
      dataSource: DATA_SOURCE,
      database: DATABASE,
      ...body,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Data API ${action} failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

// pulls the hex string out whether Data API sent it back as a plain string or as
// extended JSON ({ $oid: "..." }) - depends on the Accept header/app config, so handle both
function oidToString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "$oid" in (value as Record<string, unknown>)) {
    return (value as { $oid: string }).$oid;
  }
  return undefined;
}

// wraps a hex id for a filter - Data API needs { $oid } to match by ObjectId instead
// of doing a string comparison against the field
function oidFilter(id: string): { $oid: string } {
  return { $oid: id };
}

export async function findOne<T>(
  collection: string,
  filter: Record<string, unknown>
): Promise<(T & { _id: string }) | null> {
  const result = await callDataApi<{ document: (Record<string, unknown> & { _id: unknown }) | null }>(
    "findOne",
    { collection, filter }
  );
  if (!result.document) return null;
  const id = oidToString(result.document._id) ?? String(result.document._id);
  return { ...(result.document as T), _id: id };
}

export async function findById<T>(
  collection: string,
  id: string
): Promise<(T & { _id: string }) | null> {
  if (!OBJECT_ID_RE.test(id)) return null;
  return findOne<T>(collection, { _id: oidFilter(id) });
}

export async function insertOne(
  collection: string,
  document: Record<string, unknown>
): Promise<string> {
  const result = await callDataApi<{ insertedId: unknown }>("insertOne", { collection, document });
  const id = oidToString(result.insertedId);
  if (!id) throw new Error("Data API insertOne did not return an insertedId");
  return id;
}

export async function updateById(
  collection: string,
  id: string,
  update: Record<string, unknown>
): Promise<void> {
  await callDataApi("updateOne", {
    collection,
    filter: { _id: oidFilter(id) },
    update: { $set: update },
  });
}
