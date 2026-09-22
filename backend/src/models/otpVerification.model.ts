/**
 * Separate from `renter` on purpose: the renter document might not exist
 * yet (first-time phone number), so the verification attempt needs
 * somewhere to live independently until it succeeds. Same hashing
 * approach as everywhere else tonight - never store the real code.
 */
export interface IOtpVerification {
  _id: string;
  phone: string;
  codeHash: string;
  expiresAt: string;
  consumedAt: string | null; // soft-consumed, not deleted - same convention as declinedAt/sharedAt on UserScore
  createdAt: string;
}

export const OTP_VERIFICATION_COLLECTION = "otpVerifications";
