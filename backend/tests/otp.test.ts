import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { randomBytes } from "crypto";

// OTP send/verify (dev plan 3.1 + 3.2) through the real routes. dataApi is an in-memory store
// that follows Mongo for what the OTP code uses: equality, null matching a missing field, $lt /
// $gt / $gte / $ne, and updateOne with $inc / $set applied only when the filter matches.
// The mock SMS provider prints codes with console.log - that's how these tests "receive" them.
// (Parallel brute-force against real Mongo is covered in occubuy-integration's npm run e2e:sdk.)

type Doc = Record<string, unknown> & { _id: string };
const store = new Map<string, Doc[]>();
let nextId = 1;

function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    return Object.entries(expected as Record<string, unknown>).every(([op, value]) => {
      if (op === "$ne") return value === null ? actual !== null && actual !== undefined : actual !== value;
      if (actual === undefined || actual === null) return false;
      const a = actual as number | string;
      const v = value as number | string;
      if (op === "$lt") return a < v;
      if (op === "$gt") return a > v;
      if (op === "$gte") return a >= v;
      throw new Error(`fake store: unsupported operator ${op}`);
    });
  }
  if (expected === null) return actual === null || actual === undefined;
  return actual === expected;
}

const matches = (doc: Doc, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([key, value]) => fieldMatches(doc[key], value));

vi.mock("../src/config/dataApi", async () => {
  const actual = await vi.importActual<typeof import("../src/config/dataApi")>("../src/config/dataApi");
  return {
    OBJECT_ID_RE: actual.OBJECT_ID_RE,
    findOne: vi.fn(async (c: string, f: Record<string, unknown>) => (store.get(c) ?? []).find((d) => matches(d, f)) ?? null),
    findById: vi.fn(async (c: string, id: string) => (store.get(c) ?? []).find((d) => d._id === id) ?? null),
    insertOne: vi.fn(async (c: string, doc: Record<string, unknown>) => {
      const _id = (nextId++).toString(16).padStart(24, "0");
      store.set(c, [...(store.get(c) ?? []), { ...doc, _id }]);
      return _id;
    }),
    updateById: vi.fn(async (c: string, id: string, update: Record<string, unknown>) => {
      const doc = (store.get(c) ?? []).find((d) => d._id === id);
      if (doc) Object.assign(doc, update);
    }),
    updateOne: vi.fn(async (c: string, filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      const doc = (store.get(c) ?? []).find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      for (const [field, by] of Object.entries(update.$inc ?? {})) doc[field] = ((doc[field] as number) ?? 0) + (by as number);
      Object.assign(doc, update.$set ?? {});
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
});

import { app } from "../src/app";
import { generateApiKey } from "../src/utils/crypto";
import { normalizeAuMobile, maskPhone } from "../src/utils/phone";

const partnerId = "a".repeat(24);
const key = generateApiKey(partnerId);
const PHONE = "0412 345 678";
const E164 = "+61412345678";

let sentCodes: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store.clear();
  nextId = 1;
  sentCodes = [];
  store.set("partners", [
    { _id: "p1", portalPartnerId: partnerId, apiKeyPrefix: key.prefix, apiKeyHash: key.hash, status: "live" },
  ]);
  logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    const match = /^\[OTP mock\] code for \+\d+: (\d{6})$/.exec(String(args[0]));
    if (match?.[1]) sentCodes.push(match[1]);
  });
});

afterEach(() => {
  logSpy.mockRestore();
});

const send = (phone: string = PHONE) =>
  request(app).post("/api/renters/send-otp").set("Authorization", `Bearer ${key.fullKey}`).send({ phone });
const verify = (code: string, phone: string = PHONE) =>
  request(app).post("/api/renters/verify-otp").set("Authorization", `Bearer ${key.fullKey}`).send({ phone, code });
const lastCode = () => sentCodes[sentCodes.length - 1] ?? "";
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");
const events = (type: string) => (store.get("partnerEvents") ?? []).filter((e) => e.eventType === type);

describe("normalizeAuMobile (one phone format everywhere)", () => {
  it.each([
    ["0412 345 678", E164],
    ["0412345678", E164],
    ["0412-345-678", E164],
    ["+61 412 345 678", E164],
    ["+61412345678", E164],
    ["61412345678", E164],
    ["(04) 1234 5678", E164],
  ])("%j -> +61412345678", (input, expected) => {
    expect(normalizeAuMobile(input)).toBe(expected);
  });

  it.each(["0212345678", "041234567", "04123456789", "+1 412 345 678", "412345678", "", "abc", 412345678])(
    "rejects %j",
    (input) => {
      expect(normalizeAuMobile(input)).toBeNull();
    }
  );

  it("masks for logs", () => {
    expect(maskPhone(E164)).toBe("+614•• ••• 678");
  });
});

describe("OTP routes", () => {
  it("need a partner key", async () => {
    expect((await request(app).post("/api/renters/send-otp").send({ phone: PHONE })).status).toBe(401);
    expect((await request(app).post("/api/renters/verify-otp").send({ phone: PHONE, code: "123456" })).status).toBe(401);
    expect(sentCodes).toHaveLength(0);
  });

  it("send -> verify gives a renterId; codes are 6 digits", async () => {
    expect((await send()).status).toBe(200);
    expect(lastCode()).toMatch(/^\d{6}$/);

    const res = await verify(lastCode());
    expect(res.status).toBe(200);
    expect(res.body.renterId).toEqual(expect.any(String));
  });

  it("same person typing their number differently is the same renter", async () => {
    await send("0412 345 678");
    const first = (await verify(lastCode(), "0412 345 678")).body.renterId;

    await send("+61412345678");
    const second = (await verify(lastCode(), "+61 412 345 678")).body.renterId;

    expect(second).toBe(first);
    expect(store.get("renters")).toHaveLength(1);
    expect(store.get("renters")?.[0]?.phone).toBe(E164);
  });

  it("a code only works once", async () => {
    await send();
    const code = lastCode();
    expect((await verify(code)).status).toBe(200);
    expect((await verify(code)).status).toBe(401);
  });

  it("resend: only the newest code works (the old bug)", async () => {
    await send();
    const oldCode = lastCode();
    await send();
    const newCode = lastCode();
    if (oldCode === newCode) return; // 1 in a million, nothing to compare

    expect((await verify(oldCode)).status).toBe(401);
    expect((await verify(newCode)).status).toBe(200);
  });

  it("5 wrong guesses burn the code, even the right one fails after that", async () => {
    await send();
    const code = lastCode();

    for (let i = 1; i <= 4; i++) {
      const res = await verify(wrongCode(code));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("OTP_INVALID");
    }
    const fifth = await verify(wrongCode(code));
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe("OTP_TOO_MANY_ATTEMPTS");

    expect((await verify(code)).status).toBe(401);
    expect(events("otp.locked")).toHaveLength(1);

    // a new code works again
    await send();
    expect((await verify(lastCode())).status).toBe(200);
  });

  it("expired codes don't work", async () => {
    await send();
    const otp = store.get("otpVerifications")?.[0];
    if (otp) otp.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect((await verify(lastCode())).status).toBe(401);
  });

  it("max 3 codes per number per 10 minutes, then 429 with Retry-After, then fine again", async () => {
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200);

    const blocked = await send("+61 412 345 678"); // same number, other format - still counted
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("OTP_RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.body.retryAfterSeconds).toBeLessThanOrEqual(600);
    expect(sentCodes).toHaveLength(3);

    // a different number isn't affected
    expect((await send("0498 765 432")).status).toBe(200);

    // window passes
    const window = (store.get("otpSendWindows") ?? []).find((w) => w.phone === E164);
    if (window) window.windowStart = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    expect((await send()).status).toBe(200);
  });

  it("rejects bad input before doing anything", async () => {
    expect((await send("12345")).status).toBe(400);
    expect((await verify("12ab56")).status).toBe(400);
    expect((await verify("1234567")).status).toBe(400);
    expect(sentCodes).toHaveLength(0);
  });

  it("logs events without the full phone number or the code", async () => {
    await send();
    const code = lastCode();
    await verify(wrongCode(code));
    await verify(code);

    const all = JSON.stringify(store.get("partnerEvents"));
    expect(events("otp.sent")).toHaveLength(1);
    expect(events("otp.verify_failed")).toHaveLength(1);
    expect(events("otp.verified")).toHaveLength(1);
    expect(all).not.toContain("412345678");
    expect(all).not.toContain(code);
    expect(events("otp.sent")[0]?.partnerId).toBe(partnerId);
  });

  it("never stores the code itself", async () => {
    await send();
    expect(JSON.stringify(store.get("otpVerifications"))).not.toContain(lastCode());
  });

  it("respects the partner's allowed websites", async () => {
    const partner = store.get("partners")?.[0];
    if (partner) partner.allowedOrigins = ["https://jmrealestate.example"];

    const res = await request(app)
      .post("/api/renters/send-otp")
      .set("Authorization", `Bearer ${key.fullKey}`)
      .set("Origin", "https://copycat.example")
      .send({ phone: PHONE });
    expect(res.status).toBe(403);
    expect(sentCodes).toHaveLength(0);
  });
});

// keep randomBytes import meaningful: a fresh random key must not work
it("an unknown key can't send codes", async () => {
  const res = await request(app)
    .post("/api/renters/send-otp")
    .set("Authorization", `Bearer pk_sandbox_${partnerId}_${randomBytes(24).toString("hex")}`)
    .send({ phone: PHONE });
  expect(res.status).toBe(401);
});
