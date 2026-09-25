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

function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => doc[key] === value);
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

import { app } from "../src/app";

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

function createScore(key: string) {
  return request(app)
    .post("/api/scores")
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
