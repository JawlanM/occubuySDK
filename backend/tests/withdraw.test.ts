import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";

// Who may call the withdrawal endpoint. The full flow against a real database is in
// mongo.direct.test.ts; this only checks the secret, so it never touches the DB.
vi.mock("../src/config/dataApi", async () => {
  const actual = await vi.importActual<typeof import("../src/config/dataApi")>("../src/config/dataApi");
  return {
    OBJECT_ID_RE: actual.OBJECT_ID_RE,
    findOne: vi.fn(async () => null),
    findById: vi.fn(async () => null),
    insertOne: vi.fn(async () => "id"),
    updateById: vi.fn(),
    updateOne: vi.fn(),
  };
});

import * as dataApi from "../src/config/dataApi";
import { app } from "../src/app";

const REAL = { app: process.env.OCCUBUY_APP_SECRET, internal: process.env.OCCUBUY_INTERNAL_SECRET };
afterEach(() => {
  process.env.OCCUBUY_APP_SECRET = REAL.app;
  process.env.OCCUBUY_INTERNAL_SECRET = REAL.internal;
  if (REAL.app === undefined) delete process.env.OCCUBUY_APP_SECRET;
  if (REAL.internal === undefined) delete process.env.OCCUBUY_INTERNAL_SECRET;
});

const withdraw = (secret?: string) => {
  const req = request(app).post(`/api/internal/scores/${"a".repeat(24)}/withdraw`);
  return secret === undefined ? req : req.set("X-App-Secret", secret);
};

describe("POST /api/internal/scores/:scoreId/withdraw - access", () => {
  it("is closed when no app secret is configured", async () => {
    delete process.env.OCCUBUY_APP_SECRET;
    const res = await withdraw("anything");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("NOT_CONFIGURED");
    expect(dataApi.findById).not.toHaveBeenCalled();
  });

  it("needs the app's own secret: none, a wrong one, or the portal's secret all get 401", async () => {
    process.env.OCCUBUY_APP_SECRET = "app-secret";
    process.env.OCCUBUY_INTERNAL_SECRET = "portal-secret";
    for (const secret of [undefined, "wrong", "portal-secret"]) {
      const res = await withdraw(secret);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("APP_SECRET_INVALID");
    }
    expect(dataApi.findById).not.toHaveBeenCalled();
  });

  it("with the right secret, an unknown score is a 404", async () => {
    process.env.OCCUBUY_APP_SECRET = "app-secret";
    const res = await withdraw("app-secret");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SCORE_NOT_FOUND");
  });
});
