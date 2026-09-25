import { Request, Response, NextFunction } from "express";
import { USERSCORE_COLLECTION } from "../models/Userscore.model";
import { PARTNER_COLLECTION } from "../models/partner.model";
import { findById, findOne } from "../config/dataApi";
import { secretMatchesHash } from "../utils/crypto";
import { logEvent } from "../utils/auditLog";

// What the portal's verify-key endpoint actually gives us back - not the full IPartner
// shape (legalName, abn, branding, etc.), since the portal's own Partner schema doesn't
// carry those and now owns identity. See models/partner.model.ts for the pre-portal shape
// still used by the local seed script.
export interface VerifiedPartner {
  _id: string;
  category: string | undefined;
  status: string | undefined;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partner?: VerifiedPartner;
    }
  }
}

// Reads the partner key from Authorization. NOTE: a same-day push tried consolidating
// the session token onto this same header too (removing X-Occubuy-Session), matching a
// backend-contract/openapi.yaml with a single BearerAuth scheme. Not taken here as-is:
// it broke every SDK call past bank-connection (the SDK still sends the session token
// via X-Occubuy-Session, not Authorization) and it dropped the partner-ownership check
// on GET /scores/:scoreId (see the 29 Aug security fix below), reopening that gap. If
// that consolidation happens for real, it needs the session token itself redesigned to
// prove ownership (e.g. signed, encoding partnerId) instead of just moving header names.
export function extractBearer(req: Request): string | null {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

// same check as requirePartnerAuth below but doesn't reject on failure, just returns null -
// need that for GET /scores/:scoreId where a bad partner key should fall through to the
// session-token check instead of dying immediately
//
// The portal is still the only place a key is generated or rotated (source of truth for
// identity, see integration-memory.md Phase 0/2) - but instead of calling it on every
// request, this checks a local copy that the portal pushes to on key generation (see
// routes/internal.routes.ts's POST /partners/sync). Keeps the hot path off the network
// and off the portal's own uptime.
interface LocalPartnerRecord {
  portalPartnerId: string;
  apiKeyHash?: string;
  category?: string;
  status?: string;
}

// statuses the portal uses for a partner that's been switched off (admin suspend/pause/
// archive, or rejected). the portal pushes status changes here via /partners/sync, this
// is what actually makes them stop the key. draft/pending_review stay allowed on purpose -
// the portal hands out sandbox keys before approval and partners test with them.
const INACTIVE_PARTNER_STATUSES = new Set(["paused", "suspended", "archived", "rejected"]);

export async function authenticatePartnerKey(req: Request): Promise<VerifiedPartner | null> {
  const key = extractBearer(req);
  if (!key) return null;

  const lastUnderscore = key.lastIndexOf("_");
  const prefix = lastUnderscore === -1 ? key : key.slice(0, lastUnderscore);

  const partner = await findOne<LocalPartnerRecord>(PARTNER_COLLECTION, { apiKeyPrefix: prefix });
  if (!partner?.apiKeyHash || !secretMatchesHash(key, partner.apiKeyHash)) {
    logEvent("auth.partner_key_invalid", { detail: { route: req.path, reason: "no_local_match" } });
    return null;
  }

  if (partner.status && INACTIVE_PARTNER_STATUSES.has(partner.status)) {
    logEvent("auth.partner_key_invalid", {
      partnerId: partner.portalPartnerId,
      detail: { route: req.path, reason: "partner_inactive", status: partner.status },
    });
    return null;
  }

  return { _id: partner.portalPartnerId, category: partner.category, status: partner.status };
}

// checks the partner's key, basically the same idea as a stripe publishable key - fine to
// have this sitting in the partner's own page source, it just identifies who's calling,
// it doesn't unlock any specific customer's score on its own (that's the session token below)
export async function requirePartnerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const partner = await authenticatePartnerKey(req);
  if (!partner) {
    logEvent("auth.partner_key_invalid", { detail: { route: req.path } });
    res.status(401).json({ message: "Missing or invalid partner API key", code: "PARTNER_KEY_INVALID" });
    return;
  }

  //attach that partners info onto that request if successfull then call next
  req.partner = partner;
  next();
}

// checks the per-flow token (X-Occubuy-Session header) matches this exact scoreId and
// hasn't expired. this is the part that actually stops someone with just the partner key
// from reading/sharing/declining a score that isn't theirs
export async function verifySessionToken(scoreId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const scoreDoc = await findById<{ sessionTokenHash: string; sessionTokenExpiresAt?: string }>(
    USERSCORE_COLLECTION,
    scoreId
  );
  if (!scoreDoc) return false;
  if (!secretMatchesHash(token, scoreDoc.sessionTokenHash)) return false;
  if (scoreDoc.sessionTokenExpiresAt && Date.now() > Date.parse(scoreDoc.sessionTokenExpiresAt)) {
    return false;
  }
  return true;
}

function sessionHeader(req: Request): string | undefined {
  const header = req.headers["x-occubuy-session"];
  return typeof header === "string" ? header : undefined;
}

// session token alone isn't enough - it also has to come with the partner key of the
// partner that owns this score. before this, /share /complete /decline never read the
// Authorization header at all, so partner B's key (or no key) + partner A's session token
// got A's score back (found by Jansen, same gap the GET /scores/:scoreId fix closed on 29 Aug).
// 404 not 403 on a partner mismatch so we don't confirm the score exists for someone else.
export function requireSessionAuth(req: Request, res: Response, next: NextFunction): void {
  const { scoreId } = req.params as { scoreId: string };
  Promise.all([verifySessionToken(scoreId, sessionHeader(req)), authenticatePartnerKey(req)])
    .then(async ([sessionOk, partner]) => {
      if (!sessionOk) {
        logEvent("auth.session_invalid", { scoreId, detail: { route: req.path } });
        res.status(401).json({ message: "Invalid or missing session token", code: "SESSION_INVALID" });
        return;
      }
      if (!partner) {
        res.status(401).json({ message: "Missing or invalid partner API key", code: "PARTNER_KEY_INVALID" });
        return;
      }
      const scoreDoc = await findById<{ partnerId: string }>(USERSCORE_COLLECTION, scoreId);
      if (!scoreDoc || scoreDoc.partnerId !== partner._id) {
        logEvent("auth.session_invalid", {
          partnerId: partner._id,
          scoreId,
          detail: { route: req.path, reason: "partner_mismatch" },
        });
        res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
        return;
      }
      req.partner = partner;
      next();
    })
    .catch(next);
}

export { sessionHeader };

