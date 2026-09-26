/**
 * Separate from `renter` on purpose: the renter document might not exist
 * yet (first-time phone number), so the verification attempt needs
 * somewhere to live independently until it succeeds. Same hashing
 * approach as everywhere else tonight - never store the real code.
 */
export interface IOtpVerification {
  _id: string;
  phone: string; // E.164, always via utils/phone.ts normalizeAuMobile
  codeHash: string;
  expiresAt: string;
  consumedAt: string | null; // soft-consumed, not deleted - same convention as declinedAt/sharedAt on UserScore
  // wrong guesses so far; the code is burned (consumedAt set) at MAX_VERIFY_ATTEMPTS
  attempts?: number;
  // why it stopped being usable, if not by a correct code
  retiredReason?: "superseded" | "too_many_attempts";
  partnerId?: string; // whose widget asked for it
  createdAt: string;
}

export const OTP_VERIFICATION_COLLECTION = "otpVerifications";

/**
 * One doc per phone: how many codes were sent in the current window. Lets send-otp be rate
 * limited with the db-proxy's existing findOne/insertOne/updateById, no counting query needed.
 */
export interface IOtpSendWindow {
  _id: string;
  phone: string;
  windowStart: string;
  sends: number;
}

export const OTP_SEND_WINDOW_COLLECTION = "otpSendWindows";
