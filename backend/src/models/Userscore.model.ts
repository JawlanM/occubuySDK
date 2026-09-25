interface ILinkedAccount {
  providerId?: number;
  providerAccountId: number;
  requestId: string;
  providerName?: string;
  additionalStatus?: string;
}

interface IScoreData {
  value: number;
  band: "Excellent" | "Good" | "Fair" | "Poor" | "Insufficient Data";
}

// comes from the partner's application form, checked again in validators.ts before we
// actually create a score with it
export interface IApplicant {
  fullName: string;
  email: string;
  phone: string;
  dob: string; // ISO date string, e.g. "1998-04-12"
  address: string;
}

// plain interface, not a mongoose Document - queries go through the Data API
// (see config/dataApi.ts), not a live driver connection
export interface IUserScore {
  _id: string;
  userId: string;
  // IPartner._id. Scopes partner-key GET access to this score.
  partnerId: string;
  applicant: IApplicant;
  status: "CREATED" | "PROCESSING" | "COMPLETED" | "FAILED";
  linkedAccount?: ILinkedAccount;
  score?: IScoreData;
  // hash of the token POST /scores hands back once - every later call for this scoreId
  // has to bring it, that's what actually locks the score to this one flow
  sessionTokenHash: string;
  // token stops working after this, even if otherwise correct - keeps a leaked token's
  // exposure window short instead of it being valid forever
  sessionTokenExpiresAt: string;
  sharedAt?: string | null;
  declinedAt?: string | null;
  // when the portal confirmed it has this shared score as a lead (services/leadPush.ts);
  // null/missing on a shared score = not there yet, the retry sweep picks it up
  leadPushedAt?: string | null;
  leadPushSweepId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const USERSCORE_COLLECTION = "userscores";
