import { IAudit } from "./audit.schema";

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

// Plain interface, not a Mongoose Document - queries go through the Data API (config/dataApi.ts).
export interface IPartner {
  _id: string;
  partnerId: string;
  legalName: string;
  tradingName?: string;
  abn: string;
  // e.g. "pk_sandbox_jmrealestate"; safe to expose in partner page source.
  apiKeyPrefix: string;
  // Only the hash is ever stored, never the real key.
  apiKeyHash: string;
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

export const PARTNER_COLLECTION = "partners";
