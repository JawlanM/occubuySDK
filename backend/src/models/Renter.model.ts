
/**
 * renter model moves from a lack of verification with userID being just a crypto.randomUUID()
 * created a renters via phone number to confirm their identity
 */



export interface IRenter {
  _id: string;
  phone: string; // E.164 format
  phoneVerifiedAt: string | null; // null until they complete OTP at least once
  createdAt: string;
  updatedAt: string;
}
 
export const RENTER_COLLECTION = "renters";