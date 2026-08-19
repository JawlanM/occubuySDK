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
  applicant: IApplicant;
  status: "CREATED" | "PROCESSING" | "COMPLETED" | "FAILED";
  linkedAccount?: ILinkedAccount;
  score?: IScoreData;
  // hash of the token POST /scores hands back once - every later call for this scoreId
  // has to bring it, that's what actually locks the score to this one flow
  sessionTokenHash: string;
  sharedAt?: string | null;
  declinedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const USERSCORE_COLLECTION = "userscores";
