import { insertOne } from "../config/dataApi";
import { PARTNER_EVENT_COLLECTION, PartnerEventType } from "../models/partnerEvent.model";

// Fire-and-forget: failures are logged, not thrown, so this never blocks a request.
export function logEvent(
  eventType: PartnerEventType,
  fields: { partnerId?: string | null; scoreId?: string | null; detail?: Record<string, unknown> } = {}
): void {
  insertOne(PARTNER_EVENT_COLLECTION, {
    eventType,
    partnerId: fields.partnerId ?? null,
    scoreId: fields.scoreId ?? null,
    detail: fields.detail ?? {},
    createdAt: new Date().toISOString(),
  }).catch((err) => {
    console.error(`Failed to write audit event "${eventType}":`, err);
  });
}
