import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

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
import { app } from "../src/app";

const REAL_SECRET = process.env.OCCUBUY_INTERNAL_SECRET;

beforeEach(() => {
  process.env.OCCUBUY_INTERNAL_SECRET = "test-internal-secret";
  vi.mocked(dataApi.findOne).mockReset();
  vi.mocked(dataApi.insertOne).mockReset().mockResolvedValue("new-id");
  vi.mocked(dataApi.updateById).mockReset().mockResolvedValue(undefined);
});

afterAll(() => {
  process.env.OCCUBUY_INTERNAL_SECRET = REAL_SECRET;
});

describe("POST /api/internal/partners/sync", () => {
  it("rejects a request with a wrong or missing internal secret", async () => {
    const res = await request(app)
      .post("/api/internal/partners/sync")
      .set("X-Internal-Secret", "not-the-real-secret")
      .send({ portalPartnerId: "p1", fullKey: "pk_sandbox_p1_abc" });

    expect(res.status).toBe(401);
    expect(dataApi.insertOne).not.toHaveBeenCalled();
  });

  it("inserts a new local partner record on first sync", async () => {
    vi.mocked(dataApi.findOne).mockResolvedValue(null);

    const res = await request(app)
      .post("/api/internal/partners/sync")
      .set("X-Internal-Secret", "test-internal-secret")
      .send({ portalPartnerId: "p1", fullKey: "pk_sandbox_p1_abc123", status: "live", category: "property" });

    expect(res.status).toBe(200);
    expect(dataApi.insertOne).toHaveBeenCalledTimes(1);
    const [, doc] = vi.mocked(dataApi.insertOne).mock.calls[0];
    expect(doc).toMatchObject({
      portalPartnerId: "p1",
      apiKeyPrefix: "pk_sandbox_p1",
      status: "live",
      category: "property",
    });
    expect(doc.apiKeyHash).toBeTypeOf("string");
  });

  it("rejects a first sync with no fullKey", async () => {
    vi.mocked(dataApi.findOne).mockResolvedValue(null);

    const res = await request(app)
      .post("/api/internal/partners/sync")
      .set("X-Internal-Secret", "test-internal-secret")
      .send({ portalPartnerId: "p1", status: "live" });

    expect(res.status).toBe(400);
    expect(dataApi.insertOne).not.toHaveBeenCalled();
  });

  it("updates the existing record in place on a later sync (e.g. key rotation or status change)", async () => {
    vi.mocked(dataApi.findOne).mockResolvedValue({
      _id: "local-id-1",
      portalPartnerId: "p1",
      apiKeyPrefix: "pk_sandbox_p1",
      apiKeyHash: "old-hash",
    } as any);

    const res = await request(app)
      .post("/api/internal/partners/sync")
      .set("X-Internal-Secret", "test-internal-secret")
      .send({ portalPartnerId: "p1", status: "suspended" });

    expect(res.status).toBe(200);
    expect(dataApi.insertOne).not.toHaveBeenCalled();
    expect(dataApi.updateById).toHaveBeenCalledWith(
      "partners",
      "local-id-1",
      expect.objectContaining({ status: "suspended" }),
    );
    // a status-only sync shouldn't touch the existing key
    const [, , update] = vi.mocked(dataApi.updateById).mock.calls[0];
    expect(update.apiKeyPrefix).toBeUndefined();
  });
});
