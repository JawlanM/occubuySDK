import { Schema } from "mongoose";


export interface IAudit {
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export const auditSchema = new Schema<IAudit>(
  {
    createdAt: { type: Date, required: true, default: Date.now },
    createdBy: { type: String, required: true },
    updatedAt: { type: Date, required: true, default: Date.now },
    updatedBy: { type: String, required: true },
  },
  { _id: false } // sub document does not need id
);