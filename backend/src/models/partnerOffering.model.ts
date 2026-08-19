import { Schema, model, Document, Types } from "mongoose";
import { auditSchema, IAudit } from "../models/audit.schema";


interface IEligibility {
  minDeposit?: number;
  suburbs?: string[];
  memberSegment?: string;
}

export interface IPartnerOffering extends Document {
  offeringId: string;
  partnerId: Types.ObjectId;
  title: string;
  shortDescription: string;
  longDescription?: string;
  heroImage?: string;
  gallery?: string[];
  category: "mortgage" | "property" | "insurance" | "utility" | "lifestyle";
  subCategory?: string;
  tags?: string[];
  terms?: Record<string, unknown>;
  pricingDetails?: Record<string, unknown>;
  eligibility?: IEligibility;
  displayPriority?: number;
  featuredFlag?: boolean;
  status: "draft" | "pending_review" | "live" | "paused" | "archived";
  version: number;
  audit: IAudit;
}

const PartnerOfferingSchema = new Schema<IPartnerOffering>({
  offeringId: { type: String, required: true, unique: true },

  //pointer to a document in the `Partner` collection, not a copy of its data.
  partnerId: { type: Schema.Types.ObjectId, ref: "Partner", required: true },

  title: { type: String, required: true },
  shortDescription: { type: String, required: true, maxlength: 200 },
  longDescription: { type: String },
  heroImage: { type: String },
  gallery: { type: [String], default: [] },
  category: {
    type: String,
    enum: ["mortgage", "property", "insurance", "utility", "lifestyle"],
    required: true,
  },
  subCategory: { type: String },
  tags: { type: [String], default: [] },

  terms: { type: Schema.Types.Mixed },
  pricingDetails: { type: Schema.Types.Mixed },

  eligibility: {
    minDeposit: Number,
    suburbs: { type: [String], default: [] },
    memberSegment: String,
  },

  displayPriority: { type: Number, default: 0 },
  featuredFlag: { type: Boolean, default: false },

  status: {
    type: String,
    enum: ["draft", "pending_review", "live", "paused", "archived"],
    required: true,
    default: "draft",
  },

  // Increments on each material edit 
  //  Logic doesnt exist yet, just lies in controller
  version: { type: Number, required: true, default: 1 },

  audit: { type: auditSchema, required: true },
});

PartnerOfferingSchema.index({ offeringId: 1 }, { unique: true });
PartnerOfferingSchema.index({ partnerId: 1, status: 1 });
PartnerOfferingSchema.index({ category: 1, status: 1, displayPriority: -1 });

export const PartnerOffering = model<IPartnerOffering>(
  "PartnerOffering",
  PartnerOfferingSchema
);