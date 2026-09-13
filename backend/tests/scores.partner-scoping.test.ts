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
import { generateApiKey } from "../src/utils/crypto";
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

const originalFetch = global.fetch;

beforeEach(() => {
  // Routes call insertOne for audit logging too; give it a resolved default.
  vi.mocked(dataApi.insertOne).mockResolvedValue("event-id-placeholder");
  vi.mocked(dataApi.updateById).mockResolvedValue(undefined);

  vi.mocked(dataApi.findById).mockImplementation(async (collection: string, id: string) => {
    if (collection === "userscores" && id === scoreId) return sharedScore as any;
    return null;
  });

  // authenticatePartnerKey() calls the portal's verify-key endpoint instead of a local
  // collection now (Phase 2) - stand in for the portal here.
  global.fetch = vi.fn(async (_url, init) => {
    const { apiKey } = JSON.parse((init?.body as string) ?? "{}") as { apiKey?: string };
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
