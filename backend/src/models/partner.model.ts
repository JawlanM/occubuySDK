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

// plain interface, not a mongoose Document - queries go through the Data API
// (see config/dataApi.ts), not a live driver connection
export interface IPartner {
  _id: string;
  partnerId: string;
  legalName: string;
  tradingName?: string;
  abn: string;
  // e.g. "pk_sandbox_jmrealestate" - fine to have this sitting in the partner's page source
  apiKeyPrefix: string;
  // we only ever store the hash, never the real key
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
