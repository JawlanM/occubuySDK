/**
 * The fix for "the system doesn't know the identity." Previously, `userId`
 * on a score was just crypto.randomUUID() from the SDK — no verification,
 * no way to recognise the same person across two different partner sites.
 *
 * A `renter` is real: a phone number, confirmed via OTP, that persists
 * across every partner they interact with. Same Data API pattern as
 * partner.model.ts (plain interface, no Mongoose Schema — queries go
 * through config/dataApi.ts / db-proxy).
 */
export interface IRenter {
  _id: string;
  phone: string; // E.164 format, e.g. "+61400000000" - the actual identity key
  phoneVerifiedAt: string | null; // null until they complete OTP at least once
  createdAt: string;
  updatedAt: string;
}

export const RENTER_COLLECTION = "renters";
