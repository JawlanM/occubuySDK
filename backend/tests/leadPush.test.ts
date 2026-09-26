import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// The lead push retry (services/leadPush.ts) and the catch-up sweep behind
// POST /api/internal/leads/retry. dataApi is a small in-memory store that follows Mongo's
// rules for the filters the sweep uses: {$ne: x}, and "field: null" also matching a missing
// field (old scores from before leadPushedAt existed).

type Doc = Record<string, unknown> & { _id: string };
const store = new Map<string, Doc[]>();

function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object" && "$ne" in expected) {
    const ne = (expected as { $ne: unknown }).$ne;
    return ne === null ? actual !== null && actual !== undefined : actual !== ne;
  }
  if (expected === null) return actual === null || actual === undefined;
  return actual === expected;
}

vi.mock("../src/config/dataApi", async () => {
  const actual = await vi.importActual<typeof import("../src/config/dataApi")>("../src/config/dataApi");
  return {
    OBJECT_ID_RE: actual.OBJECT_ID_RE,
    findOne: vi.fn(async (collection: string, filter: Record<string, unknown>) =>
      (store.get(collection) ?? []).find((doc) => Object.entries(filter).every(([k, v]) => fieldMatches(doc[k], v))) ?? null
    ),
    findById: vi.fn(async (collection: string, id: string) => (store.get(collection) ?? []).find((d) => d._id === id) ?? null),
    insertOne: vi.fn(async (collection: string, document: Record<string, unknown>) => {
      store.set(collection, [...(store.get(collection) ?? []), { ...document, _id: `id-${Math.random()}` }]);
      return "inserted";
    }),
    updateById: vi.fn(async (collection: string, id: string, update: Record<string, unknown>) => {
      const doc = (store.get(collection) ?? []).find((d) => d._id === id);
      if (doc) Object.assign(doc, update);
    }),
  };
});

import { app } from "../src/app";
import { pushLeadWithRetry, retryPendingLeadPushes } from "../src/services/leadPush";
import type { IUserScore } from "../src/models/Userscore.model";

const SECRET = "test-internal-secret";
const REAL_SECRET = process.env.OCCUBUY_INTERNAL_SECRET;
const originalFetch = global.fetch;
let portalUp = true;
let pushedScoreIds: string[] = [];

function score(id: string, extra: Record<string, unknown> = {}): Doc {
  return {
    _id: id,
    partnerId: "p".repeat(24),
    status: "COMPLETED",
    score: { value: 700, band: "Very Good" },
    sharedAt: "2026-09-26T00:00:00.000Z",
    declinedAt: null,
    ...extra,
  };
}

const asScore = (doc: Doc) => doc as unknown as IUserScore;
const byId = (id: string) => (store.get("userscores") ?? []).find((d) => d._id === id);

beforeEach(() => {
  store.clear();
  portalUp = true;
  pushedScoreIds = [];
  process.env.OCCUBUY_INTERNAL_SECRET = SECRET;
  global.fetch = vi.fn(async (url, init) => {
    if (!String(url).includes("/api/internal/leads")) return new Response("{}", { status: 500 });
    if (!portalUp) throw new TypeError("fetch failed");
    pushedScoreIds.push(JSON.parse(String(init?.body)).scoreId);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.OCCUBUY_INTERNAL_SECRET = REAL_SECRET;
});

describe("pushLeadWithRetry", () => {
  it("marks leadPushedAt when the portal takes it first time", async () => {
    store.set("userscores", [score("s1")]);

    expect(await pushLeadWithRetry(asScore(score("s1")), [0, 0])).toBe(true);
    expect(pushedScoreIds).toEqual(["s1"]);
    expect(byId("s1")?.leadPushedAt).toEqual(expect.any(String));
  });

  it("gets there on a retry if the portal comes back", async () => {
    store.set("userscores", [score("s1")]);
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("fetch failed");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    expect(await pushLeadWithRetry(asScore(score("s1")), [0, 0])).toBe(true);
    expect(calls).toBe(3);
    expect(byId("s1")?.leadPushedAt).toEqual(expect.any(String));
  });

  it("gives up after the retries, logs it, leaves the score unmarked", async () => {
    store.set("userscores", [score("s1")]);
    portalUp = false;

    expect(await pushLeadWithRetry(asScore(score("s1")), [0, 0])).toBe(false);
    expect(byId("s1")?.leadPushedAt).toBeUndefined();
    const event = (store.get("partnerEvents") ?? []).find((e) => e.eventType === "score.portal_sync_failed");
    expect(event).toMatchObject({ scoreId: "s1", detail: { attempts: 3 } });
  });

  it("doesn't push a score that isn't shared", async () => {
    expect(await pushLeadWithRetry(asScore(score("s1", { sharedAt: null })), [])).toBe(false);
    expect(pushedScoreIds).toEqual([]);
  });
});

describe("retryPendingLeadPushes (the catch-up sweep)", () => {
  it("pushes every shared-but-unconfirmed score once, skips the rest", async () => {
    store.set("userscores", [
      score("pending-1", { leadPushedAt: null }),
      score("pending-old"), // from before leadPushedAt existed, field missing entirely
      score("already-pushed", { leadPushedAt: "2026-09-26T01:00:00.000Z" }),
      score("not-shared", { sharedAt: null }),
      score("declined", { declinedAt: "2026-09-26T02:00:00.000Z" }),
    ]);

    expect(await retryPendingLeadPushes()).toEqual({ pushed: 2, failed: 0 });
    expect(pushedScoreIds.sort()).toEqual(["pending-1", "pending-old"]);
    expect(byId("pending-1")?.leadPushedAt).toEqual(expect.any(String));
    expect(byId("pending-old")?.leadPushedAt).toEqual(expect.any(String));

    // nothing left on a second run
    pushedScoreIds = [];
    expect(await retryPendingLeadPushes()).toEqual({ pushed: 0, failed: 0 });
    expect(pushedScoreIds).toEqual([]);
  });

  it("portal still down: tries each once, doesn't loop, leaves them for next time", async () => {
    store.set("userscores", [score("a"), score("b")]);
    portalUp = false;

    expect(await retryPendingLeadPushes()).toEqual({ pushed: 0, failed: 2 });

    portalUp = true;
    expect(await retryPendingLeadPushes()).toEqual({ pushed: 2, failed: 0 });
  });

  it("is reachable at POST /api/internal/leads/retry, behind the internal secret", async () => {
    store.set("userscores", [score("s1")]);

    expect((await request(app).post("/api/internal/leads/retry").set("X-Internal-Secret", "wrong")).status).toBe(401);
    expect(pushedScoreIds).toEqual([]);

    const res = await request(app).post("/api/internal/leads/retry").set("X-Internal-Secret", SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pushed: 1, failed: 0 });
  });
});
