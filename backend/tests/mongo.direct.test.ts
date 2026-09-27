import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

// The real config/dataApi.ts against a real MongoDB (no mocks), plus the OTP routes on top of
// it, since OTP relies most on Mongo doing the "only if still under the limit" updates.
// Needs a throwaway Mongo: TEST_MONGODB_URI=mongodb://127.0.0.1:<port> npx vitest run mongo
// Skipped when it isn't set, so CI and a plain `npm test` don't need a database.
const TEST_URI = process.env.TEST_MONGODB_URI;
const SECRET = "direct-mongo-test-secret";
const PHONE = "0412345678";

describe.skipIf(!TEST_URI)("direct MongoDB (no db-proxy)", () => {
  let dataApi: typeof import("../src/config/dataApi");
  let app: Express;
  let partnerKey: string;
  const sentCodes: string[] = [];

  beforeAll(async () => {
    // dataApi reads these when it's first imported
    process.env.MONGODB_URI = TEST_URI;
    process.env.MONGODB_DATABASE = `direct_test_${Date.now()}`;
    process.env.OCCUBUY_INTERNAL_SECRET = SECRET;
    dataApi = await import("../src/config/dataApi");
    ({ app } = await import("../src/app"));

    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const match = /\[OTP mock\] code for \S+: (\d{6})/.exec(String(args[0]));
      if (match) sentCodes.push(match[1]);
    });

    partnerKey = `pk_sandbox_directtest_${Date.now().toString(36)}abc`;
    const sync = await request(app)
      .post("/api/internal/partners/sync")
      .set("X-Internal-Secret", SECRET)
      .send({ portalPartnerId: "direct-test-partner", fullKey: partnerKey, status: "live" });
    expect(sync.status).toBe(200);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (dataApi) {
      const db = await dataApi.connectDb();
      await db.dropDatabase();
      await dataApi.closeDb();
    }
  });

  describe("dataApi", () => {
    it("inserts and reads back by id, with _id as a string", async () => {
      const id = await dataApi.insertOne("direct_things", { name: "a", count: 1 });
      expect(id).toMatch(dataApi.OBJECT_ID_RE);
      const doc = await dataApi.findById<{ name: string; count: number }>("direct_things", id);
      expect(doc).toEqual({ _id: id, name: "a", count: 1 });
    });

    it("stores Dates as ISO strings, same as when everything went over JSON", async () => {
      const when = new Date("2026-09-27T10:00:00.000Z");
      const id = await dataApi.insertOne("direct_things", { when });
      const doc = await dataApi.findById<{ when: unknown }>("direct_things", id);
      expect(doc?.when).toBe("2026-09-27T10:00:00.000Z");
    });

    it("returns null for a malformed or unknown id", async () => {
      expect(await dataApi.findById("direct_things", "not-an-id")).toBeNull();
      expect(await dataApi.findById("direct_things", "0".repeat(24))).toBeNull();
    });

    it("updateById sets fields, updateOne only applies when the filter holds", async () => {
      const id = await dataApi.insertOne("direct_things", { hits: 0 });
      await dataApi.updateById("direct_things", id, { label: "x" });

      const first = await dataApi.updateOne("direct_things", { _id: id, hits: { $lt: 1 } }, { $inc: { hits: 1 } });
      const second = await dataApi.updateOne("direct_things", { _id: id, hits: { $lt: 1 } }, { $inc: { hits: 1 } });
      expect(first.matchedCount).toBe(1);
      expect(second.matchedCount).toBe(0);
      expect(await dataApi.findById("direct_things", id)).toMatchObject({ hits: 1, label: "x" });
    });

    it("still accepts the old { $oid } filter shape", async () => {
      const id = await dataApi.insertOne("direct_things", { tag: "oid" });
      expect(await dataApi.findOne("direct_things", { _id: { $oid: id } })).toMatchObject({ tag: "oid" });
    });
  });

  describe("OTP on real Mongo", () => {
    const send = () =>
      request(app).post("/api/renters/send-otp").set("Authorization", `Bearer ${partnerKey}`).send({ phone: PHONE });
    const verify = (code: string) =>
      request(app)
        .post("/api/renters/verify-otp")
        .set("Authorization", `Bearer ${partnerKey}`)
        .send({ phone: PHONE, code });

    it("sends a code, rejects a wrong one, accepts the right one once and creates the renter", async () => {
      expect((await send()).status).toBe(200);
      const code = sentCodes.at(-1)!;
      const wrong = code === "000000" ? "111111" : "000000";

      expect((await verify(wrong)).status).toBe(401);

      const ok = await verify(code);
      expect(ok.status).toBe(200);
      expect(ok.body.renterId).toMatch(dataApi.OBJECT_ID_RE);
      expect(await dataApi.findById("renters", ok.body.renterId)).toMatchObject({ phone: "+61412345678" });

      // already used
      expect((await verify(code)).status).toBe(401);
    });

    it("a burst of parallel wrong guesses gets at most 5 tries, then the code is burned", async () => {
      expect((await send()).status).toBe(200);
      const code = sentCodes.at(-1)!;
      const wrong = code === "000000" ? "111111" : "000000";

      const results = await Promise.all(Array.from({ length: 8 }, () => verify(wrong)));
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(4);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(4);

      // even the right code is refused now
      expect((await verify(code)).status).not.toBe(200);
    });

    it("allows 3 sends per 10 minutes, then 429 with Retry-After", async () => {
      // two sends already used by the tests above
      expect((await send()).status).toBe(200);
      const limited = await send();
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe("OTP_RATE_LIMITED");
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    });
  });
});
