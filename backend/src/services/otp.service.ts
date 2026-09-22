import { findOne, insertOne, updateById } from "../config/dataApi";
import { hashSecret, secretMatchesHash } from "../utils/crypto";
import { IOtpVerification, OTP_VERIFICATION_COLLECTION } from "../models/otpVerification.model";
import { IRenter, RENTER_COLLECTION } from "../models/renter.model";

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function deliverCode(phone: string, code: string): void {
  const provider = process.env.OTP_PROVIDER ?? "mock";

  if (provider === "mock") {
    // In real life this is an SMS. In mock mode, it's just printed here
    console.log(`[OTP mock] code for ${phone}: ${code}`);
    return;
  }

  throw new Error(`Unknown OTP_PROVIDER: ${provider}`);
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

export async function sendOtp(phone: string): Promise<void> {
  const code = generateCode();
  const now = new Date();

  await insertOne(OTP_VERIFICATION_COLLECTION, {
    phone,
    codeHash: hashSecret(code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString(),
    consumedAt: null,
    createdAt: now.toISOString(),
  });

  deliverCode(phone, code);
}

export async function verifyOtp(
  phone: string,
  code: string
): Promise<{ renterId: string } | null> {
  const attempt = await findOne<IOtpVerification>(OTP_VERIFICATION_COLLECTION, {
    phone,
    consumedAt: null,
  });

  if (!attempt) return null;
  if (Date.now() > Date.parse(attempt.expiresAt)) return null;
  if (!secretMatchesHash(code, attempt.codeHash)) return null;

  await updateById(OTP_VERIFICATION_COLLECTION, attempt._id, {
    consumedAt: new Date().toISOString(),
  });

  // Find-or-create the renter. This phone might be brand new, or might
  // already exist from a previous verification with a different partner.
  const now = new Date().toISOString();
  const existing = await findOne<IRenter>(RENTER_COLLECTION, { phone });

  if (existing) {
    await updateById(RENTER_COLLECTION, existing._id, { phoneVerifiedAt: now, updatedAt: now });
    return { renterId: existing._id };
  }

  const renterId = await insertOne(RENTER_COLLECTION, {
    phone,
    phoneVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return { renterId };
}