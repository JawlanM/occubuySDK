import { Schema, model, Document } from "mongoose";

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

export interface IUserScore extends Document {
  userId: string;
  applicant: IApplicant;
  status: "CREATED" | "PROCESSING" | "COMPLETED" | "FAILED";
  linkedAccount?: ILinkedAccount;
  score?: IScoreData;
  // hash of the token POST /scores hands back once - every later call for this scoreId
  // has to bring it, that's what actually locks the score to this one flow
  sessionTokenHash: string;
  sharedAt?: Date | null;
  declinedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserScoreSchema = new Schema<IUserScore>(
  {
    userId: { type: String, required: true, index: true },

    applicant: {
      fullName: { type: String, required: true },
      email: { type: String, required: true, lowercase: true },
      phone: { type: String, required: true },
      dob: { type: String, required: true },
      address: { type: String, required: true },
    },

    status: {
      type: String,
      enum: ["CREATED", "PROCESSING", "COMPLETED", "FAILED"],
      required: true,
      default: "CREATED",
    },

    sessionTokenHash: { type: String, required: true, select: false },
    sharedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },

//Fastlinnk success payload
// Filled in when POST /scores/{id}/complete is called

linkedAccount: {
      providerId: Number,
      providerAccountId: Number,
      requestId: String,
      providerName: String,
      additionalStatus: String,
    },

//fill when mock score engine returns

score: {
      value: { type: Number, min: 0, max: 1000 },
      band: {
        type: String,
        enum: ["Excellent", "Good", "Fair", "Poor", "Insufficient Data"],
      },
    },
  },
  { timestamps: true }
);

export const UserScore = model<IUserScore>("UserScore", UserScoreSchema);