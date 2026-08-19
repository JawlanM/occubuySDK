import { Request, Response, NextFunction } from "express";
import { Partner, IPartner } from "../models/partner.model";
import { UserScore } from "../models/Userscore.model";
import { secretMatchesHash } from "../utils/crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partner?: IPartner;
    }
  }
}

function extractBearer(req: Request): string | null {
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
  const partner = await Partner.findOne({ apiKeyPrefix: prefix }).select("+apiKeyHash");

  if (!partner || !secretMatchesHash(key, partner.apiKeyHash)) return null;
  return partner;
}

// checks the partner's key, basically the same idea as a stripe publishable key - fine to
// have this sitting in the partner's own page source, it just identifies who's calling,
// it doesn't unlock any specific customer's score on its own (that's the session token below)
export async function requirePartnerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const partner = await authenticatePartnerKey(req);
  if (!partner) {
    res.status(401).json({ message: "Missing or invalid partner API key", code: "PARTNER_KEY_INVALID" });
    return;
  }
  req.partner = partner;
  next();
}

// checks the per-flow token (X-Occubuy-Session header) matches this exact scoreId.
// this is the part that actually stops someone with just the partner key from
// reading/sharing/declining a score that isn't theirs
export async function verifySessionToken(scoreId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const scoreDoc = await UserScore.findById(scoreId).select("+sessionTokenHash");
  if (!scoreDoc) return false;
  return secretMatchesHash(token, scoreDoc.sessionTokenHash);
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
        res.status(401).json({ message: "Invalid or missing session token", code: "SESSION_INVALID" });
        return;
      }
      next();
    })
    .catch(next);
}

export { sessionHeader };
