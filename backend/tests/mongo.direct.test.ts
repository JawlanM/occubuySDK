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

  describe("score flow on real Mongo", () => {
    const start = async () => {
      const res = await request(app)
        .post("/api/scores")
        .set("Authorization", `Bearer ${partnerKey}`)
        .send({ userId: "r1", applicant: { fullName: "Test Renter", email: "r@x.test", phone: "0412 345 678", dob: "1995-05-05", address: "1 Test Street, Melbourne" } });
      expect(res.status).toBe(201);
      return res.body as { scoreId: string; sessionToken: string };
    };
    const complete = (scoreId: string, token: string) =>
      request(app)
        .post(`/api/scores/${scoreId}/complete`)
        .set("Authorization", `Bearer ${partnerKey}`)
        .set("X-Occubuy-Session", token)
        .send({ providerId: 1, providerName: "Test Bank A", providerAccountId: 2, requestId: "q", status: "SUCCESS" });

    it("/complete returns the score straight away, GET returns the same one", async () => {
      const { scoreId, sessionToken } = await start();
      const done = await complete(scoreId, sessionToken);
      expect(done.status).toBe(200);
      expect(done.body.status).toBe("COMPLETED");
      expect(done.body.score.value).toBeGreaterThanOrEqual(0);

      const got = await request(app)
        .get(`/api/scores/${scoreId}`)
        .set("Authorization", `Bearer ${partnerKey}`)
        .set("X-Occubuy-Session", sessionToken);
      expect(got.body).toEqual(done.body);

      const stored = await dataApi.findById<{ linkedAccount: { providerName: string } }>("userscores", scoreId);
      expect(stored?.linkedAccount.providerName).toBe("Test Bank A");
      expect((await complete(scoreId, sessionToken)).status).toBe(409);
    });

    it("parallel /complete calls score exactly once", async () => {
      const { scoreId, sessionToken } = await start();
      const results = await Promise.all(Array.from({ length: 6 }, () => complete(scoreId, sessionToken)));
      const ok = results.filter((r) => r.status === 200);
      expect(ok).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      const stored = await dataApi.findById<{ score: { value: number } }>("userscores", scoreId);
      expect(stored?.score.value).toBe(ok[0].body.score.value);
    });

    it("a score left in PROCESSING (older flow) is scored once by parallel polls", async () => {
      const { scoreId, sessionToken } = await start();
      await dataApi.updateById("userscores", scoreId, { status: "PROCESSING" });
      const polls = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(app).get(`/api/scores/${scoreId}`).set("Authorization", `Bearer ${partnerKey}`).set("X-Occubuy-Session", sessionToken)
        )
      );
      const values = new Set(polls.map((p) => p.body.score?.value));
      expect(polls.every((p) => p.body.status === "COMPLETED")).toBe(true);
      expect(values.size).toBe(1);
    });
  });

  describe("withdrawal on real Mongo", () => {
    const APP_SECRET = "direct-test-app-secret";
    const portalCalls: Array<{ url: string; method: string }> = [];

    const shareOne = async () => {
      const created = await request(app)
        .post("/api/scores")
        .set("Authorization", `Bearer ${partnerKey}`)
        .send({ userId: "r1", applicant: { fullName: "Test Renter", email: "r@x.test", phone: "0412 345 678", dob: "1995-05-05", address: "1 Test Street, Melbourne" } });
      const { scoreId, sessionToken } = created.body as { scoreId: string; sessionToken: string };
      const h = { Authorization: `Bearer ${partnerKey}`, "X-Occubuy-Session": sessionToken };
      await request(app).post(`/api/scores/${scoreId}/complete`).set(h).send({ providerId: 1, providerName: "B", providerAccountId: 2, requestId: "q", status: "SUCCESS" });
      expect((await request(app).post(`/api/scores/${scoreId}/share`).set(h)).status).toBe(200);
      return { scoreId, h };
    };
    const withdraw = (scoreId: string) =>
      request(app).post(`/api/internal/scores/${scoreId}/withdraw`).set("X-App-Secret", APP_SECRET);

    beforeAll(() => {
      process.env.OCCUBUY_APP_SECRET = APP_SECRET;
      process.env.LEAD_PUSH_RETRY_DELAYS_MS = "0,0";
      // the portal: accept lead pushes and withdrawals, record them
      vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        portalCalls.push({ url: String(url), method: init?.method ?? "GET" });
        return new Response("{}", { status: 200 });
      }));
    });
    afterAll(() => {
      vi.unstubAllGlobals();
    });

    it("deletes the renter's data and the score, keeps ids only, tells the portal, and reads become 410", async () => {
      const { scoreId, h } = await shareOne();
      const res = await withdraw(scoreId);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("withdrawn");

      const stored = await dataApi.findById<Record<string, unknown>>("userscores", scoreId);
      expect(stored?.status).toBe("WITHDRAWN");
      for (const gone of ["applicant", "score", "linkedAccount", "userId", "sessionTokenHash"]) {
        expect(stored?.[gone]).toBeUndefined();
      }
      expect(stored?.partnerId).toBe("direct-test-partner");

      await vi.waitFor(async () => {
        expect(portalCalls.some((c) => c.method === "DELETE" && c.url.endsWith(`/api/internal/leads/${scoreId}`))).toBe(true);
        const after = await dataApi.findById<{ leadWithdrawnAt?: string }>("userscores", scoreId);
        expect(after?.leadWithdrawnAt).toEqual(expect.any(String));
      });

      // partner key alone, after sharing: gone
      expect((await request(app).get(`/api/scores/${scoreId}`).set("Authorization", `Bearer ${partnerKey}`)).status).toBe(410);
      // the renter's session no longer works either
      expect((await request(app).post(`/api/scores/${scoreId}/share`).set(h)).status).toBe(401);
      // twice is fine
      expect((await withdraw(scoreId)).body.alreadyWithdrawn).toBe(true);
    });

    it("more than 12 months after sharing: 409, nothing changed", async () => {
      const { scoreId } = await shareOne();
      const thirteenMonthsAgo = new Date(Date.now() - 395 * 24 * 60 * 60 * 1000).toISOString();
      await dataApi.updateById("userscores", scoreId, { sharedAt: thirteenMonthsAgo });

      const res = await withdraw(scoreId);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("WITHDRAWAL_WINDOW_CLOSED");
      expect((await dataApi.findById<{ status: string }>("userscores", scoreId))?.status).toBe("COMPLETED");
    });

    it("the sweep re-sends a withdrawal the portal missed, and never re-pushes the withdrawn lead", async () => {
      const { scoreId } = await shareOne();
      await withdraw(scoreId);
      await vi.waitFor(async () =>
        expect((await dataApi.findById<{ leadWithdrawnAt?: string }>("userscores", scoreId))?.leadWithdrawnAt).toBeTruthy()
      );
      // pretend the portal never confirmed
      await dataApi.updateOne("userscores", { _id: scoreId }, { $set: { leadWithdrawnAt: null, leadPushedAt: null } });
      portalCalls.length = 0;

      const swept = await request(app).post("/api/internal/leads/retry").set("X-Internal-Secret", SECRET);
      expect(swept.status).toBe(200);
      expect(swept.body.withdrawn).toBeGreaterThanOrEqual(1);
      expect(portalCalls.some((c) => c.method === "DELETE" && c.url.endsWith(scoreId))).toBe(true);
      expect(portalCalls.some((c) => c.method === "POST" && c.url.endsWith("/api/internal/leads"))).toBe(false);
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
      // how many land as 401 (invalid, or the code was already burned when it arrived) vs 429
      // depends on timing; what can't change is that none pass and only 5 were ever checked
      expect(results.every((r) => r.status === 401 || r.status === 429)).toBe(true);
      expect(results.some((r) => r.status === 429)).toBe(true);
      const db = await dataApi.connectDb();
      const burned = await db.collection("otpVerifications").find({ phone: "+61412345678" }).sort({ _id: -1 }).limit(1).next();
      expect(burned?.attempts).toBe(5);
      expect(burned?.retiredReason).toBe("too_many_attempts");

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
