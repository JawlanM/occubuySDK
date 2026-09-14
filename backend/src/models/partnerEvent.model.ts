// Append-only audit trail for consent/security events.
export type PartnerEventType =
  | "score.created"
  | "score.bank_connected"
  | "score.completed"
  | "score.shared"
  | "score.declined"
  | "score.portal_sync_failed"
  | "auth.partner_key_invalid"
  | "auth.session_invalid";

export interface IPartnerEvent {
  _id: string;
  eventType: PartnerEventType;
  partnerId?: string | null;
  scoreId?: string | null;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export const PARTNER_EVENT_COLLECTION = "partnerEvents";
