import { timingSafeEqual } from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { internalSecret } from "../config/portalClient";
import { findOne, insertOne, updateById } from "../config/dataApi";
import { PARTNER_COLLECTION } from "../models/partner.model";
import { hashSecret } from "../utils/crypto";
import { normalizeOriginList } from "../utils/origins";
import { retryPendingLeadPushes } from "../services/leadPush";

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
  const { portalPartnerId, fullKey, status, category, allowedOrigins } = req.body as {
    portalPartnerId?: string;
    fullKey?: string;
    status?: string;
    category?: string;
    allowedOrigins?: unknown;
  };

  if (typeof portalPartnerId !== "string" || !portalPartnerId) {
    res.status(400).json({ message: "portalPartnerId is required" });
    return;
  }

  // optional - left out = don't touch what's stored (older portal builds don't send it),
  // [] = partner cleared their list. anything malformed is rejected outright rather than
  // half-stored, since a bad entry here decides which websites a key works on.
  let origins: string[] | undefined;
  if (allowedOrigins !== undefined) {
    const normalized = normalizeOriginList(allowedOrigins);
    if (!normalized) {
      res.status(400).json({ message: "allowedOrigins must be a list of http(s) origins, e.g. https://example.com" });
      return;
    }
    origins = normalized;
  }

  const existing = await findOne<PartnerSyncRecord>(PARTNER_COLLECTION, { portalPartnerId });

  // the real partners collection still has a unique index on partnerId from the old
  // create-partner.ts seed script - a synced record has no human-readable partnerId of its
  // own, so reuse portalPartnerId there too instead of leaving it unset (which Mongo treats
  // as null, and a unique index only ever allows one null).
  const update: Record<string, unknown> = {
    portalPartnerId,
    partnerId: portalPartnerId,
    updatedAt: new Date().toISOString(),
  };
  if (status) update.status = status;
  else if (!existing) update.status = "approved"; // first sync, no status given - safe default
  if (category) update.category = category;
  if (origins) update.allowedOrigins = origins;

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

// Re-pushes every shared score the portal never confirmed as a lead (e.g. the portal was down
// when the renter shared). Safe to call any time - the portal upserts on scoreId.
internalRouter.post("/leads/retry", async (_req: Request, res: Response) => {
  res.status(200).json(await retryPendingLeadPushes());
});
