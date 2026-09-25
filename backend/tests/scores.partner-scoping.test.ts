import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { IPartner } from "../src/models/partner.model";
import type { IUserScore } from "../src/models/Userscore.model";

// scores.routes.ts still goes through config/dataApi for score reads/writes - mock it here
// so this test never touches the real Atlas Data API. Partner auth now checks a local
// "partners" copy (synced from the portal on key generation, see routes/internal.routes.ts)
// instead of calling the portal on every request, so findOne doubles as that lookup below.
vi.mock("../src/config/dataApi", async () => {
  const actual = await vi.importActual<typeof import("../src/config/dataApi")>(
    "../src/config/dataApi"
  );
  return {
    OBJECT_ID_RE: actual.OBJECT_ID_RE,
    findOne: vi.fn(),
    findById: vi.fn(),
    insertOne: vi.fn(),
    updateById: vi.fn(),
  };
});

import * as dataApi from "../src/config/dataApi";
import { generateApiKey, generateSessionToken } from "../src/utils/crypto";
import { app } from "../src/app";

const keyA = generateApiKey("partnerA");
const keyB = generateApiKey("partnerB");

// portalPartnerId is what authenticatePartnerKey() returns as req.partner._id - keeping it
// equal to _id here so the rest of this test (which keys scores off partnerA._id) doesn't
// need to change.
const partnerA: IPartner & { portalPartnerId: string } = {
  _id: "a".repeat(24),
  portalPartnerId: "a".repeat(24),
  partnerId: "partnerA",
  legalName: "Partner A Pty Ltd",
  abn: "00000000000",
  apiKeyPrefix: keyA.prefix,
  apiKeyHash: keyA.hash,
  category: "property",
  status: "approved",
  primaryContact: { name: "A", email: "a@example.test", phone: "0400000000" },
  audit: { createdAt: new Date(), createdBy: "test", updatedAt: new Date(), updatedBy: "test" },
};

const partnerB: IPartner & { portalPartnerId: string } = {
  ...partnerA,
  _id: "b".repeat(24),
  portalPartnerId: "b".repeat(24),
  partnerId: "partnerB",
  apiKeyPrefix: keyB.prefix,
  apiKeyHash: keyB.hash,
};

const scoreId = "c".repeat(24);

const sharedScore: IUserScore = {
  _id: scoreId,
  userId: "user-1",
  partnerId: partnerA._id, // belongs to partner A
  applicant: {
    fullName: "Test User",
    email: "user@example.test",
    phone: "0400000001",
    dob: "1998-01-01",
    address: "1 Test St",
  },
  status: "COMPLETED",
  score: { value: 720, band: "Good" },
  sessionTokenHash: "not-used-in-this-test",
  sharedAt: new Date().toISOString(),
  declinedAt: null,
};

const shareScoreId = "d".repeat(24);
const shareSessionToken = generateSessionToken();

const unsharedScore: IUserScore = {
  _id: shareScoreId,
  userId: "user-2",
  partnerId: partnerA._id,
  applicant: sharedScore.applicant,
  status: "COMPLETED",
  score: { value: 812, band: "Excellent" }, // stored under the old band name on purpose
  sessionTokenHash: shareSessionToken.hash,
  sharedAt: null,
  declinedAt: null,
};

const originalFetch = global.fetch;

// Toggled per-test to exercise the "portal push fails" path (Phase 3) without that ever
// affecting a /share response's own status/body - see the "never blocks the customer"
// tests below.
let portalLeadPushShouldFail = false;
let portalLeadPushCalls: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LEAD_PUSH_RETRY_DELAYS_MS = "0,0"; // retries without waiting 1s/5s
  // Routes call insertOne for audit logging too; give it a resolved default.
  vi.mocked(dataApi.insertOne).mockResolvedValue("event-id-placeholder");
  vi.mocked(dataApi.updateById).mockResolvedValue(undefined);

  vi.mocked(dataApi.findById).mockImplementation(async (collection: string, id: string) => {
    if (collection === "userscores" && id === scoreId) return sharedScore as any;
    if (collection === "userscores" && id === shareScoreId) return unsharedScore as any;
    return null;
  });

  // Local partner lookup by apiKeyPrefix - the synced copy authenticatePartnerKey() now
  // checks instead of calling the portal (see middleware/auth.ts).
  vi.mocked(dataApi.findOne).mockImplementation(async (collection: string, filter: Record<string, unknown>) => {
    if (collection !== "partners") return null;
    const prefix = filter.apiKeyPrefix as string | undefined;
    if (prefix === partnerA.apiKeyPrefix) return partnerA as any;
    if (prefix === partnerB.apiKeyPrefix) return partnerB as any;
    return null;
  });

  portalLeadPushShouldFail = false;
  portalLeadPushCalls = [];

  // Stands in for the portal, which this backend still calls once, fire-and-forget, when a
  // score gets shared (Phase 3, pushLeadToPortal).
  global.fetch = vi.fn(async (url, init) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;

    if (String(url).includes("/leads")) {
      portalLeadPushCalls.push(body);
      if (portalLeadPushShouldFail) return new Response(JSON.stringify({ message: "nope" }), { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ message: "unexpected fetch in test" }), { status: 500 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("GET /api/scores/:scoreId - partner scoping", () => {
  it("blocks a different partner from reading a score that isn't theirs, even once shared", async () => {
    const res = await request(app)
      .get(`/api/scores/${scoreId}`)
      .set("Authorization", `Bearer ${keyB.fullKey}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SCORE_NOT_FOUND");
    expect(res.body.score).toBeUndefined();
  });

  it("lets the owning partner read their own shared score", async () => {
    const res = await request(app)
      .get(`/api/scores/${scoreId}`)
      .set("Authorization", `Bearer ${keyA.fullKey}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.score.value).toBe(720);
  });
});

// portal pushes status changes (admin suspend/archive etc) through /partners/sync - once
// the local copy says the partner is switched off, their key has to stop working
describe("inactive partners", () => {
  for (const status of ["paused", "suspended", "archived", "rejected"]) {
    it(`rejects a ${status} partner's key`, async () => {
      vi.mocked(dataApi.findOne).mockResolvedValue({ ...partnerA, status } as any);

      const res = await request(app)
        .get(`/api/scores/${scoreId}`)
        .set("Authorization", `Bearer ${keyA.fullKey}`);

      expect(res.status).toBe(401);
      expect(res.body.score).toBeUndefined();
    });
  }

  it("still lets a draft partner use their sandbox key", async () => {
    vi.mocked(dataApi.findOne).mockResolvedValue({ ...partnerA, status: "draft" } as any);

    const res = await request(app)
      .get(`/api/scores/${scoreId}`)
      .set("Authorization", `Bearer ${keyA.fullKey}`);

    expect(res.status).toBe(200);
  });
});

// Jansen's test: partner B's key + partner A's session token + A's scoreId. Session token is
// valid, key is valid, they just don't belong together - has to be a 404 with no score in it.
describe("session-token routes - partner scoping", () => {
  const routes = ["share", "decline", "complete"] as const;

  for (const route of routes) {
    it(`blocks another partner's key on POST /${route} even with a valid session token`, async () => {
      const res = await request(app)
        .post(`/api/scores/${shareScoreId}/${route}`)
        .set("Authorization", `Bearer ${keyB.fullKey}`)
        .set("X-Occubuy-Session", shareSessionToken.token);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("SCORE_NOT_FOUND");
      expect(res.body.score).toBeUndefined();
      expect(dataApi.updateById).not.toHaveBeenCalled();
    });

    it(`rejects POST /${route} with a valid session token but no partner key`, async () => {
      const res = await request(app)
        .post(`/api/scores/${shareScoreId}/${route}`)
        .set("X-Occubuy-Session", shareSessionToken.token);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("PARTNER_KEY_INVALID");
      expect(dataApi.updateById).not.toHaveBeenCalled();
    });
  }

  it("rejects the owning partner's key with no session token", async () => {
    const res = await request(app)
      .post(`/api/scores/${shareScoreId}/share`)
      .set("Authorization", `Bearer ${keyA.fullKey}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SESSION_INVALID");
  });
});

describe("POST /api/scores/:scoreId/share - portal lead push (Phase 3)", () => {
  it("pushes the shared score to the portal as a lead", async () => {
    const res = await request(app)
      .post(`/api/scores/${shareScoreId}/share`)
      .set("Authorization", `Bearer ${keyA.fullKey}`)
      .set("X-Occubuy-Session", shareSessionToken.token);

    expect(res.status).toBe(200);
    expect(res.body.score).toBe(812);

    // the push is fire-and-forget - give its microtask a tick to run
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(portalLeadPushCalls).toHaveLength(1);
    expect(portalLeadPushCalls[0]).toMatchObject({
      partnerId: partnerA._id,
      scoreId: shareScoreId,
      score: 812,
      band: "strong", // recomputed from 812, not the old stored name
      renter: { fullName: "Test User", email: "user@example.test", phone: "0400000001" },
    });
  });

  it("marks the score once the portal has the lead", async () => {
    await request(app)
      .post(`/api/scores/${shareScoreId}/share`)
      .set("Authorization", `Bearer ${keyA.fullKey}`)
      .set("X-Occubuy-Session", shareSessionToken.token);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(dataApi.updateById).toHaveBeenCalledWith(
      "userscores",
      shareScoreId,
      expect.objectContaining({ leadPushedAt: expect.any(String) }),
    );
  });

  it("retries a failed push twice more, then logs it and leaves the score unmarked", async () => {
    portalLeadPushShouldFail = true;

    const res = await request(app)
      .post(`/api/scores/${shareScoreId}/share`)
      .set("Authorization", `Bearer ${keyA.fullKey}`)
      .set("X-Occubuy-Session", shareSessionToken.token);
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(portalLeadPushCalls).toHaveLength(3);
    const marked = vi.mocked(dataApi.updateById).mock.calls.some(([, , update]) => "leadPushedAt" in update);
    expect(marked).toBe(false);
    const failedEvent = vi.mocked(dataApi.insertOne).mock.calls.find(([, doc]) => doc.eventType === "score.portal_sync_failed");
    expect(failedEvent?.[1]).toMatchObject({ scoreId: shareScoreId, detail: { attempts: 3 } });
  });

  it("still returns the customer's score normally even if the portal push fails", async () => {
    portalLeadPushShouldFail = true;

    const res = await request(app)
      .post(`/api/scores/${shareScoreId}/share`)
      .set("Authorization", `Bearer ${keyA.fullKey}`)
      .set("X-Occubuy-Session", shareSessionToken.token);

    expect(res.status).toBe(200);
    expect(res.body.score).toBe(812);
    expect(res.body.band).toBe("strong");
    expect(res.body.reference).toBe(shareScoreId);
  });
});
