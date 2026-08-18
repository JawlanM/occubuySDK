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