import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { randomBytes } from "crypto";

// The receiving half of the portal's "Generate API key" button, end to end inside this
// backend: a key in exactly the portal's format goes through the real POST
// /api/internal/partners/sync, then gets used on the real POST /api/scores the way the
// widget does. The portal side of the same flow is covered in occubuy-integration's
// server/api-key-sync.test.ts. dataApi is swapped for a tiny in-memory store so what sync
// writes is exactly what auth later reads.

type Doc = Record<string, unknown> & { _id: string };
const store = new Map<string, Doc[]>();
let nextId = 1;

// equality, plus Mongo's "array field contains value" rule (CORS looks up allowedOrigins that way)
function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const field = doc[key];
    return Array.isArray(field) ? field.includes(value) : field === value;
  });
}

vi.mock("../src/config/dataApi", async () => {
  const actual = await vi.importActual<typeof import("../src/config/dataApi")>("../src/config/dataApi");
  return {
    OBJECT_ID_RE: actual.OBJECT_ID_RE,
    findOne: vi.fn(async (collection: string, filter: Record<string, unknown>) =>
      (store.get(collection) ?? []).find((doc) => matches(doc, filter)) ?? null
    ),
    findById: vi.fn(async (collection: string, id: string) =>
      (store.get(collection) ?? []).find((doc) => doc._id === id) ?? null
    ),
    insertOne: vi.fn(async (collection: string, document: Record<string, unknown>) => {
      const _id = (nextId++).toString(16).padStart(24, "0");
      store.set(collection, [...(store.get(collection) ?? []), { ...document, _id }]);
      return _id;
    }),
    updateById: vi.fn(async (collection: string, id: string, update: Record<string, unknown>) => {
      const doc = (store.get(collection) ?? []).find((d) => d._id === id);
      if (doc) Object.assign(doc, update);
    }),
  };
});

import { app, clearPartnerOriginCache } from "../src/app";

const SECRET = "test-internal-secret";
const REAL_SECRET = process.env.OCCUBUY_INTERNAL_SECRET;
const portalPartnerId = "66f1a2b3c4d5e6f708192a3b";

// same shape as occubuy-integration's generatePartnerApiKey()
function portalKey(): string {
  return `pk_sandbox_${portalPartnerId}_${randomBytes(24).toString("hex")}`;
}

function sync(body: Record<string, unknown>, secret = SECRET) {
  return request(app).post("/api/internal/partners/sync").set("X-Internal-Secret", secret).send(body);
}

function createScore(key: string, origin?: string) {
  const req = request(app).post("/api/scores");
  if (origin) req.set("Origin", origin);
  return req
    .set("Authorization", `Bearer ${key}`)
    .send({
      userId: "renter-1",
      applicant: {
        fullName: "Test Renter",
        email: "renter@example.test",
        phone: "0412 345 678",
        dob: "1995-05-05",
        address: "1 Test Street, Melbourne",
      },
    });
}

beforeEach(() => {
  process.env.OCCUBUY_INTERNAL_SECRET = SECRET;
  store.clear();
  nextId = 1;
  clearPartnerOriginCache();
});

afterAll(() => {
  process.env.OCCUBUY_INTERNAL_SECRET = REAL_SECRET;
});

describe("portal key generation -> sync -> the key works here", () => {
  it("a freshly generated key works on POST /api/scores right after sync", async () => {
    const key = portalKey();
    expect((await sync({ portalPartnerId, fullKey: key, status: "live", category: "property" })).status).toBe(200);

    const res = await createScore(key);
    expect(res.status).toBe(201);
    expect(res.body.scoreId).toBeTypeOf("string");
    expect(res.body.sessionToken).toBeTypeOf("string");

    // the score is owned by the portal's partner id, which is what leads get pushed back under
    const [score] = store.get("userscores") ?? [];
    expect(score?.partnerId).toBe(portalPartnerId);

    // never the raw key at rest
    const [partner] = store.get("partners") ?? [];
    expect(JSON.stringify(partner)).not.toContain(key);
  });

  it("an unsynced key is rejected", async () => {
    await sync({ portalPartnerId, fullKey: portalKey(), status: "live" });

    const res = await createScore(portalKey());
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("PARTNER_KEY_INVALID");
  });

  it("rotation: the new key works, the old one stops, still one partner record", async () => {
    const oldKey = portalKey();
    const newKey = portalKey();
    await sync({ portalPartnerId, fullKey: oldKey, status: "live" });
    await sync({ portalPartnerId, fullKey: newKey, status: "live" });

    expect((await createScore(newKey)).status).toBe(201);
    expect((await createScore(oldKey)).status).toBe(401);
    expect(store.get("partners")).toHaveLength(1);
  });

  it("status sync from the portal switches the key off and back on, key untouched", async () => {
    const key = portalKey();
    await sync({ portalPartnerId, fullKey: key, status: "live" });

    await sync({ portalPartnerId, status: "suspended" });
    expect((await createScore(key)).status).toBe(401);

    await sync({ portalPartnerId, status: "archived" });
    expect((await createScore(key)).status).toBe(401);

    await sync({ portalPartnerId, status: "live" });
    expect((await createScore(key)).status).toBe(201);
  });

  it("a sync with the wrong internal secret changes nothing", async () => {
    const key = portalKey();
    await sync({ portalPartnerId, fullKey: key, status: "live" });

    expect((await sync({ portalPartnerId, status: "suspended" }, "wrong-secret")).status).toBe(401);
    expect((await sync({ portalPartnerId, fullKey: portalKey() }, "wrong-secret")).status).toBe(401);

    expect((await createScore(key)).status).toBe(201);
  });
});

// dev plan 1.7 - the key only works from the websites the partner registered in the portal
describe("domain binding (allowedOrigins)", () => {
  const partnerSite = "https://jmrealestate.com.au";

  it("works from a registered website, 403 from anywhere else", async () => {
    const key = portalKey();
    await sync({ portalPartnerId, fullKey: key, status: "live", allowedOrigins: [partnerSite] });

    expect((await createScore(key, partnerSite)).status).toBe(201);

    const copied = await createScore(key, "https://copycat.example");
    expect(copied.status).toBe(403);
    expect(copied.body.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(copied.body.scoreId).toBeUndefined();
    expect(store.get("userscores") ?? []).toHaveLength(1);

    // logged under the partner whose key got copied, so they can see it
    const rejected = (store.get("partnerEvents") ?? []).find((e) => e.eventType === "auth.origin_rejected");
    expect(rejected?.partnerId).toBe(portalPartnerId);
  });

  it("partner with no list yet works from anywhere (nothing that works today breaks)", async () => {
    const key = portalKey();
    await sync({ portalPartnerId, fullKey: key, status: "live" });

    expect((await createScore(key, "https://anywhere.example")).status).toBe(201);
  });

  it("localhost always works on a sandbox key, for local testing", async () => {
    const key = portalKey();
    await sync({ portalPartnerId, fullKey: key, status: "live", allowedOrigins: [partnerSite] });

    expect((await createScore(key, "http://localhost:5500")).status).toBe(201);
    expect((await createScore(key, "http://127.0.0.1:8787")).status).toBe(201);
  });

  it("no Origin header (not a browser) isn't blocked by this check", async () => {
    const key = portalKey();
    await sync({ portalPartnerId, fullKey: key, status: "live", allowedOrigins: [partnerSite] });

    expect((await createScore(key)).status).toBe(201);
  });

  it("a status-only sync without allowedOrigins keeps the stored list; [] clears it", async () => {
    const key = portalKey();
    await sync({ portalPartnerId, fullKey: key, status: "live", allowedOrigins: [partnerSite] });

    await sync({ portalPartnerId, status: "live" });
    expect((await createScore(key, "https://copycat.example")).status).toBe(403);

    await sync({ portalPartnerId, status: "live", allowedOrigins: [] });
    expect((await createScore(key, "https://copycat.example")).status).toBe(201);
  });

  it("normalises what the portal sends and rejects junk without storing any of it", async () => {
    const key = portalKey();
    await sync({ portalPartnerId, fullKey: key, status: "live", allowedOrigins: ["https://JMRealestate.com.au/"] });
    expect((await createScore(key, partnerSite)).status).toBe(201);

    for (const bad of [["not a url"], ["ftp://jmrealestate.com.au"], ["https://jmrealestate.com.au/apply"], "https://x.com"]) {
      const res = await sync({ portalPartnerId, status: "live", allowedOrigins: bad });
      expect(res.status).toBe(400);
    }
    // still the good list from before
    expect((await createScore(key, "https://copycat.example")).status).toBe(403);
  });

  it("CORS lets a registered partner website through, not an unknown one", async () => {
    const key = portalKey();
    await sync({ portalPartnerId, fullKey: key, status: "live", allowedOrigins: [partnerSite] });

    const ok = await request(app).options("/api/scores").set("Origin", partnerSite);
    expect(ok.headers["access-control-allow-origin"]).toBe(partnerSite);

    const unknown = await request(app).options("/api/scores").set("Origin", "https://copycat.example");
    expect(unknown.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
