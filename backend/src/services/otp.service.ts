import { randomInt } from "crypto";
import { findOne, insertOne, updateById, updateOne } from "../config/dataApi";
import { hashSecret, secretMatchesHash } from "../utils/crypto";
import {
  IOtpSendWindow,
  IOtpVerification,
  OTP_SEND_WINDOW_COLLECTION,
  OTP_VERIFICATION_COLLECTION,
} from "../models/otpVerification.model";
import { IRenter, RENTER_COLLECTION } from "../models/Renter.model";
import { logEvent } from "../utils/auditLog";
import { maskPhone } from "../utils/phone";

// Phones passed in here are already E.164 (routes normalise with utils/phone.ts).

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_VERIFY_ATTEMPTS = 5; // wrong guesses before the code is burned
export const MAX_SENDS_PER_WINDOW = 3; // codes per phone...
export const SEND_WINDOW_MS = 10 * 60 * 1000; // ...per 10 minutes
const MAX_RETIRE_LOOP = 20;

function deliverCode(phone: string, code: string): void {
  const provider = process.env.OTP_PROVIDER ?? "mock";

  if (provider === "mock") {
    // In real life this is an SMS. In mock mode, it's just printed here
    console.log(`[OTP mock] code for ${phone}: ${code}`);
    return;
  }

  throw new Error(`Unknown OTP_PROVIDER: ${provider}`);
}

// crypto-grade, 000000-999999 (Math.random() before, which is predictable)
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// At most MAX_SENDS_PER_WINDOW codes per phone per SEND_WINDOW_MS - stops someone using our
// endpoint to spam a number (and running up an SMS bill once it's real SMS). The common case
// is one atomic "bump the counter if still under the limit and inside the window".
async function takeSendSlot(phone: string): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const now = Date.now();
  const windowOpenSince = new Date(now - SEND_WINDOW_MS).toISOString();

  const bumped = await updateOne(
    OTP_SEND_WINDOW_COLLECTION,
    { phone, windowStart: { $gt: windowOpenSince }, sends: { $lt: MAX_SENDS_PER_WINDOW } },
    { $inc: { sends: 1 } }
  );
  if (bumped.matchedCount > 0) return { ok: true };

  const window = await findOne<IOtpSendWindow>(OTP_SEND_WINDOW_COLLECTION, { phone });
  if (window && window.windowStart > windowOpenSince) {
    const retryAfterMs = Date.parse(window.windowStart) + SEND_WINDOW_MS - now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  const fresh = { windowStart: new Date(now).toISOString(), sends: 1 };
  if (window) await updateById(OTP_SEND_WINDOW_COLLECTION, window._id, fresh);
  else await insertOne(OTP_SEND_WINDOW_COLLECTION, { phone, ...fresh });
  return { ok: true };
}

// Retire every still-usable code for this phone, so after a resend only the newest one can
// ever match. (Before, verify picked "any unconsumed code" - after a resend that could be the
// old one, and the renter's new code would fail.)
async function retireActiveCodes(phone: string, reason: "superseded"): Promise<void> {
  for (let i = 0; i < MAX_RETIRE_LOOP; i++) {
    const active = await findOne<IOtpVerification>(OTP_VERIFICATION_COLLECTION, { phone, consumedAt: null });
    if (!active) return;
    await updateById(OTP_VERIFICATION_COLLECTION, active._id, {
      consumedAt: new Date().toISOString(),
      retiredReason: reason,
    });
  }
}

export type SendOtpResult = { ok: true } | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

export async function sendOtp(phone: string, partnerId: string): Promise<SendOtpResult> {
  const slot = await takeSendSlot(phone);
  if (!slot.ok) {
    logEvent("otp.rate_limited", { partnerId, detail: { phone: maskPhone(phone) } });
    return { ok: false, reason: "rate_limited", retryAfterSeconds: slot.retryAfterSeconds };
  }

  await retireActiveCodes(phone, "superseded");

  const code = generateCode();
  const now = new Date();
  await insertOne(OTP_VERIFICATION_COLLECTION, {
    phone,
    codeHash: hashSecret(code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString(),
    consumedAt: null,
    attempts: 0,
    partnerId,
    createdAt: now.toISOString(),
  });

  deliverCode(phone, code);
  logEvent("otp.sent", { partnerId, detail: { phone: maskPhone(phone) } });
  return { ok: true };
}

export type VerifyOtpResult =
  | { ok: true; renterId: string }
  | { ok: false; reason: "invalid" | "too_many_attempts" };

export async function verifyOtp(phone: string, code: string, partnerId: string): Promise<VerifyOtpResult> {
  const attempt = await findOne<IOtpVerification>(OTP_VERIFICATION_COLLECTION, { phone, consumedAt: null });
  if (!attempt || Date.now() > Date.parse(attempt.expiresAt)) {
    logEvent("otp.verify_failed", { partnerId, detail: { phone: maskPhone(phone), reason: "no_active_code" } });
    return { ok: false, reason: "invalid" };
  }

  // Claim one of the MAX_VERIFY_ATTEMPTS guesses in the same atomic step as checking there's
  // one left. A read-then-write count would let a burst of parallel guesses all see "0 used"
  // and all get checked - with this, guess number 6 can't get a slot no matter the timing.
  const claimed = await updateOne(
    OTP_VERIFICATION_COLLECTION,
    { _id: attempt._id, consumedAt: null, attempts: { $lt: MAX_VERIFY_ATTEMPTS } },
    { $inc: { attempts: 1 } }
  );
  if (claimed.matchedCount === 0) {
    logEvent("otp.locked", { partnerId, detail: { phone: maskPhone(phone) } });
    return { ok: false, reason: "too_many_attempts" };
  }

  if (!secretMatchesHash(code, attempt.codeHash)) {
    // that was the last allowed guess -> burn the code so it can't be used at all
    const burned = await updateOne(
      OTP_VERIFICATION_COLLECTION,
      { _id: attempt._id, consumedAt: null, attempts: { $gte: MAX_VERIFY_ATTEMPTS } },
      { $set: { consumedAt: new Date().toISOString(), retiredReason: "too_many_attempts" } }
    );
    logEvent(burned.matchedCount > 0 ? "otp.locked" : "otp.verify_failed", {
      partnerId,
      detail: { phone: maskPhone(phone), reason: "wrong_code" },
    });
    return { ok: false, reason: burned.matchedCount > 0 ? "too_many_attempts" : "invalid" };
  }

  // right code - consume it, atomically, so two parallel correct submits can't both "win"
  const consumed = await updateOne(
    OTP_VERIFICATION_COLLECTION,
    { _id: attempt._id, consumedAt: null },
    { $set: { consumedAt: new Date().toISOString() } }
  );
  if (consumed.matchedCount === 0) return { ok: false, reason: "invalid" };

  // Find-or-create the renter. This phone might be brand new, or might
  // already exist from a previous verification with a different partner.
  const now = new Date().toISOString();
  const existing = await findOne<IRenter>(RENTER_COLLECTION, { phone });

  let renterId: string;
  if (existing) {
    await updateById(RENTER_COLLECTION, existing._id, { phoneVerifiedAt: now, updatedAt: now });
    renterId = existing._id;
  } else {
    renterId = await insertOne(RENTER_COLLECTION, {
      phone,
      phoneVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  logEvent("otp.verified", { partnerId, detail: { phone: maskPhone(phone), renterId } });
  return { ok: true, renterId };
}
