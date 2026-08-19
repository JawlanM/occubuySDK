import { Schema, model, Document } from "mongoose";
import { auditSchema, IAudit } from "../models/audit.schema";

interface IContact {
  name: string;
  email: string;
  phone: string;
}
 
interface ISecondaryContact extends IContact {
  role: string;
}

interface IMonetisation {
  model: "platform_fee_plus_conversion" | "conversion_only" | "subscription";
  platformFee?: {
    amount: number;
    currency: string;
    frequency: "monthly" | "annual";
  };
  conversionFee?: {
    type: "percent" | "flat";
    value: number;
    currency: string;
  };
  paymentMethodRef?: string;
  billingFrequency?: "monthly" | "annual";
}
 
interface ICompliance {
  termsVersionAccepted?: string;
  termsAcceptedAt?: Date;
  termsAcceptedBy?: string;
  supportingDocs?: Array<{ type: string; url: string; uploadedAt: Date }>;
}
 
export interface IPartner extends Document {
  partnerId: string;
  legalName: string;
  tradingName?: string;
  abn: string;
  category: "mortgage" | "property" | "insurance" | "utility" | "lifestyle";
  status:
    | "draft"
    | "pending_review"
    | "approved"
    | "live"
    | "paused"
    | "suspended"
    | "archived";
  primaryContact: IContact;
  secondaryContacts?: ISecondaryContact[];
  monetisation?: IMonetisation;
  compliance?: ICompliance;
  onboardingStage?: string;
  audit: IAudit;
}


const contactSchema = new Schema<IContact>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phone: { type: String, required: true },
  },
  { _id: false }
);
 
const PartnerSchema = new Schema<IPartner>({
  partnerId: { type: String, required: true, unique: true },
  legalName: { type: String, required: true },
  tradingName: { type: String },
  abn: { type: String, required: true },
  category: {
    type: String,
    enum: ["mortgage", "property", "insurance", "utility", "lifestyle"],
    required: true,
  },
  status: {
    type: String,
    enum: [
      "draft",
      "pending_review",
      "approved",
      "live",
      "paused",
      "suspended",
      "archived",
    ],
    required: true,
    default: "draft",
  },
  primaryContact: { type: contactSchema, required: true },
  secondaryContacts: {
    type: [
      new Schema<ISecondaryContact>(
        {
          name: { type: String, required: true },
          email: { type: String, required: true, lowercase: true },
          phone: { type: String, required: true },
          role: { type: String, required: true },
        },
        { _id: false }
      ),
    ],
    default: [],
  },
  monetisation: {
    model: {
      type: String,
      enum: ["platform_fee_plus_conversion", "conversion_only", "subscription"],
    },
    platformFee: {
      amount: Number,
      currency: String,
      frequency: { type: String, enum: ["monthly", "annual"] },
    },
    conversionFee: {
      type: { type: String, enum: ["percent", "flat"] },
      value: Number,
      currency: String,
    },
    paymentMethodRef: String,
    billingFrequency: { type: String, enum: ["monthly", "annual"] },
  },
  compliance: {
    termsVersionAccepted: String,
    termsAcceptedAt: Date,
    termsAcceptedBy: String,
    supportingDocs: {
      type: [
        {
          type: { type: String, required: true },
          url: { type: String, required: true },
          uploadedAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
  },
  onboardingStage: { type: String },
  audit: { type: auditSchema, required: true },
});

PartnerSchema.index({ partnerId: 1 }, { unique: true });
PartnerSchema.index({ status: 1 });
PartnerSchema.index({ category: 1, status: 1 });
 
export const Partner = model<IPartner>("Partner", PartnerSchema);
 