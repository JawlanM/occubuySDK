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