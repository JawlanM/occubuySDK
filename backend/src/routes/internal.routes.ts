import { timingSafeEqual } from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { internalSecret } from "../config/portalClient";
import { findOne, insertOne, updateById } from "../config/dataApi";
import { PARTNER_COLLECTION } from "../models/partner.model";
import { hashSecret } from "../utils/crypto";

// Not partner-facing - only the portal (occubuy-integration-main) calls this, gated by the
// same shared secret used the other way (middleware/auth.ts's old portal verify-key call).
// The portal stays the only place a key is generated/rotated; this just keeps this
// backend's local partner copy in sync so authenticatePartnerKey() can check it directly
// instead of calling the portal on every /api/scores request.
export const internalRouter = Router();

function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && bufA.length > 0 && timingSafeEqual(bufA, bufB);
}

function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.headers["x-internal-secret"];
  if (typeof supplied !== "string" || !secretsMatch(supplied, internalSecret())) {
    res.status(401).json({ message: "Invalid internal secret" });
    return;
  }
  next();
}

internalRouter.use(requireInternalSecret);

interface PartnerSyncRecord {
  _id: string;
  portalPartnerId: string;
  apiKeyPrefix?: string;
  apiKeyHash?: string;
}

// fullKey is only sent once, right when the portal generates/rotates it (same "shown once"
// model the portal itself uses with the partner) - a status-only sync just omits it.
internalRouter.post("/partners/sync", async (req: Request, res: Response) => {
  const { portalPartnerId, fullKey, status, category } = req.body as {
    portalPartnerId?: string;
    fullKey?: string;
    status?: string;
    category?: string;
  };

  if (typeof portalPartnerId !== "string" || !portalPartnerId) {
    res.status(400).json({ message: "portalPartnerId is required" });
    return;
  }

  const existing = await findOne<PartnerSyncRecord>(PARTNER_COLLECTION, { portalPartnerId });

  const update: Record<string, unknown> = { portalPartnerId, updatedAt: new Date().toISOString() };
  if (status) update.status = status;
  else if (!existing) update.status = "approved"; // first sync, no status given - safe default
  if (category) update.category = category;

  if (typeof fullKey === "string" && fullKey) {
    const lastUnderscore = fullKey.lastIndexOf("_");
    update.apiKeyPrefix = lastUnderscore === -1 ? fullKey : fullKey.slice(0, lastUnderscore);
    update.apiKeyHash = hashSecret(fullKey);
  }

  if (existing) {
    await updateById(PARTNER_COLLECTION, existing._id, update);
  } else {
    if (!update.apiKeyPrefix) {
      res.status(400).json({ message: "fullKey is required the first time a partner is synced" });
      return;
    }
    await insertOne(PARTNER_COLLECTION, update);
  }

  res.status(200).json({ ok: true });
});
