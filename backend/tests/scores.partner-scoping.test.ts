import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { IPartner } from "../src/models/partner.model";
import type { IUserScore } from "../src/models/Userscore.model";

// scores.routes.ts and auth.ts both go through config/dataApi for every read/write - mock
// it here so this test never touches the real Atlas Data API, and so we control exactly
// which partner/score docs exist for each case below
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

beforeEach(() => {
  vi.mocked(dataApi.insertOne).mockResolvedValue("score-id-placeholder");
  vi.mocked(dataApi.updateById).mockResolvedValue(undefined);

  vi.mocked(dataApi.findOne).mockImplementation(async (collection: string, filter: any) => {
    if (collection === "partners") {
      if (filter.apiKeyPrefix === partnerA.apiKeyPrefix) return partnerA as any;
      if (filter.apiKeyPrefix === partnerB.apiKeyPrefix) return partnerB as any;
    }
    return null;
  });
  vi.mocked(dataApi.findById).mockImplementation(async (collection: string, id: string) => {
    if (collection === "userscores" && id === scoreId) return sharedScore as any;
    return null;
  });
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
