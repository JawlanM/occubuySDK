import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { IPartner } from "../src/models/partner.model";
import type { IUserScore } from "../src/models/Userscore.model";

// scores.routes.ts still goes through config/dataApi for score reads/writes - mock it here
// so this test never touches the real Atlas Data API. Partner auth no longer does (it asks
// the portal's verify-key endpoint instead, see middleware/auth.ts Phase 2), so that's
// mocked separately below via global fetch.
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

const partnerA: IPartner = {
  _id: "a".repeat(24),
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

const partnerB: IPartner = {
  ...partnerA,
  _id: "b".repeat(24),
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
  score: { value: 812, band: "Excellent" },
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
  // Routes call insertOne for audit logging too; give it a resolved default.
  vi.mocked(dataApi.insertOne).mockResolvedValue("event-id-placeholder");
  vi.mocked(dataApi.updateById).mockResolvedValue(undefined);

  vi.mocked(dataApi.findById).mockImplementation(async (collection: string, id: string) => {
    if (collection === "userscores" && id === scoreId) return sharedScore as any;
    if (collection === "userscores" && id === shareScoreId) return unsharedScore as any;
    return null;
  });

  portalLeadPushShouldFail = false;
  portalLeadPushCalls = [];

  // Stands in for the portal for both calls this backend makes to it: verifying a partner
  // key (Phase 2, authenticatePartnerKey) and receiving a shared score as a lead (Phase 3,
  // pushLeadToPortal) - routed by URL since both go through the same global fetch.
  global.fetch = vi.fn(async (url, init) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;

    if (String(url).includes("/leads")) {
      portalLeadPushCalls.push(body);
      if (portalLeadPushShouldFail) return new Response(JSON.stringify({ message: "nope" }), { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const apiKey = body.apiKey as string | undefined;
    const match = apiKey === keyA.fullKey ? partnerA : apiKey === keyB.fullKey ? partnerB : null;
    if (!match) return new Response(JSON.stringify({ message: "Invalid key" }), { status: 401 });
    return new Response(
      JSON.stringify({ partnerId: match._id, category: match.category, status: match.status }),
      { status: 200 },
    );
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

describe("POST /api/scores/:scoreId/share - portal lead push (Phase 3)", () => {
  it("pushes the shared score to the portal as a lead", async () => {
    const res = await request(app)
      .post(`/api/scores/${shareScoreId}/share`)
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
      band: "Excellent",
    });
  });

  it("still returns the customer's score normally even if the portal push fails", async () => {
    portalLeadPushShouldFail = true;

    const res = await request(app)
      .post(`/api/scores/${shareScoreId}/share`)
      .set("X-Occubuy-Session", shareSessionToken.token);

    expect(res.status).toBe(200);
    expect(res.body.score).toBe(812);
    expect(res.body.band).toBe("Excellent");
    expect(res.body.reference).toBe(shareScoreId);
  });
});
