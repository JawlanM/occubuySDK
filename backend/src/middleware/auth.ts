import { Request, Response, NextFunction } from "express";
import { IPartner, PARTNER_COLLECTION } from "../models/partner.model";
import { USERSCORE_COLLECTION } from "../models/Userscore.model";
import { findOne, findById } from "../config/dataApi";
import { secretMatchesHash } from "../utils/crypto";
import { logEvent } from "../utils/auditLog";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partner?: IPartner;
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
export async function authenticatePartnerKey(req: Request): Promise<IPartner | null> {
  const key = extractBearer(req);
  if (!key) return null;

  const lastUnderscore = key.lastIndexOf("_");
  const prefix = lastUnderscore === -1 ? key : key.slice(0, lastUnderscore);
  const partner = await findOne<IPartner>(PARTNER_COLLECTION, { apiKeyPrefix: prefix });

  if (!partner || !secretMatchesHash(key, partner.apiKeyHash)) return null;
  return partner;
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

export function requireSessionAuth(req: Request, res: Response, next: NextFunction): void {
  const { scoreId } = req.params as { scoreId: string };
  verifySessionToken(scoreId, sessionHeader(req))
    .then((ok) => {
      if (!ok) {
        logEvent("auth.session_invalid", { scoreId, detail: { route: req.path } });
        res.status(401).json({ message: "Invalid or missing session token", code: "SESSION_INVALID" });
        return;
      }
      next();
    })
    .catch(next);
}

export { sessionHeader };

