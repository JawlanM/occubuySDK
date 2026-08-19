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
 
export interface IUserScore extends Document {
  userId: string;
  status: "CREATED" | "PROCESSING" | "COMPLETED" | "FAILED";
  linkedAccount?: ILinkedAccount;
  score?: IScoreData;
  createdAt: Date;
  updatedAt: Date;
}

const UserScoreSchema = new Schema<IUserScore>(
  {
    userId: { type: String, required: true, index: true },

    status: {
      type: String,
      enum: ["CREATED", "PROCESSING", "COMPLETED", "FAILED"],
      required: true,
      default: "CREATED",
    },
    
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