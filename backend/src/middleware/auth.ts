import { Request, Response, NextFunction } from "express";
import { IUserScore, USERSCORE_COLLECTION } from "../models/Userscore.model";
import { PARTNER_COLLECTION } from "../models/partner.model";
import { findById, findOne } from "../config/dataApi";
import { secretMatchesHash } from "../utils/crypto";
import { logEvent } from "../utils/auditLog";
import { isLocalDevOrigin } from "../utils/origins";
import type { WidgetBranding } from "../utils/branding";
import { onPartnersChanged } from "../utils/partnerCache";

// What the portal's verify-key endpoint actually gives us back - not the full IPartner
// shape (legalName, abn, branding, etc.), since the portal's own Partner schema doesn't
// carry those and now owns identity. See models/partner.model.ts for the pre-portal shape
// still used by the local seed script.
export interface VerifiedPartner {
  _id: string;
  category: string | undefined;
  status: string | undefined;
  // websites this partner's widget may run on (portal-managed, synced) - empty = not set up yet
  allowedOrigins: string[];
  // widget colours set in the portal ({} = Occubuy's own)
  branding: WidgetBranding;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partner?: VerifiedPartner;
      // the score requireSessionAuth already loaded, so the route doesn't read it again
      scoreDoc?: IUserScore;
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
  allowedOrigins?: string[];
  branding?: WidgetBranding;
}

// Only approved or live partners can use a key, same rule the portal uses for showing the
// Embed score page and handing out keys. Everything else (draft, pending_review, paused,
// suspended, archived, rejected, or no status at all) is refused. The portal pushes status
// changes here via /partners/sync, so this is what actually switches a key on and off.
const ACTIVE_PARTNER_STATUSES = new Set(["approved", "live"]);

// Partner records by key prefix, kept for 30 s so a busy flow (config, create, complete, share)
// doesn't read the partner every request. The hash is still checked every time, and any sync
// from the portal clears this, so key changes and status changes apply immediately.
const PARTNER_CACHE_MS = 30_000;
const PARTNER_CACHE_MAX = 1000;
const partnerCache = new Map<string, { partner: LocalPartnerRecord; expiresAt: number }>();
onPartnersChanged(() => partnerCache.clear());

async function findPartnerByPrefix(prefix: string): Promise<LocalPartnerRecord | null> {
  const cached = partnerCache.get(prefix);
  if (cached && cached.expiresAt > Date.now()) return cached.partner;
  const partner = await findOne<LocalPartnerRecord>(PARTNER_COLLECTION, { apiKeyPrefix: prefix });
  // only real records are cached: an unknown prefix (a typo or a guess) always goes to the DB
  if (partner) {
    if (partnerCache.size >= PARTNER_CACHE_MAX) partnerCache.clear();
    partnerCache.set(prefix, { partner, expiresAt: Date.now() + PARTNER_CACHE_MS });
  }
  return partner;
}

export async function authenticatePartnerKey(req: Request): Promise<VerifiedPartner | null> {
  const key = extractBearer(req);
  if (!key) return null;

  const lastUnderscore = key.lastIndexOf("_");
  const prefix = lastUnderscore === -1 ? key : key.slice(0, lastUnderscore);

  const partner = await findPartnerByPrefix(prefix);
  if (!partner?.apiKeyHash || !secretMatchesHash(key, partner.apiKeyHash)) {
    logEvent("auth.partner_key_invalid", { detail: { route: req.path, reason: "no_local_match" } });
    return null;
  }

  if (!partner.status || !ACTIVE_PARTNER_STATUSES.has(partner.status)) {
    logEvent("auth.partner_key_invalid", {
      partnerId: partner.portalPartnerId,
      detail: { route: req.path, reason: "partner_inactive", status: partner.status },
    });
    return null;
  }

  return {
    _id: partner.portalPartnerId,
    category: partner.category,
    status: partner.status,
    allowedOrigins: Array.isArray(partner.allowedOrigins) ? partner.allowedOrigins : [],
    branding: partner.branding && typeof partner.branding === "object" ? partner.branding : {},
  };
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

// Domain binding (dev plan 1.7): the key is public (it's in the partner's page source), so on
// its own it only says WHO is calling, not from WHERE. This checks the browser's Origin header
// against the websites the partner registered in the portal, so a key copied onto someone
// else's site gets a 403 instead of starting flows that land as this partner's leads.
// Browsers set Origin themselves and page JS can't change it. Non-browser callers can fake it,
// but they can't put the flow in front of a real renter, so that's not what this is for.
//
// Only on POST /scores - everything after that needs the score's own session token anyway.
// No website, no SDK: a partner with an empty list is refused from every website. Lets
// through: no Origin header (not a browser), and localhost on sandbox keys so partners can
// test locally before they register a site.
export function requireAllowedOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const partner = req.partner;
  if (!origin || !partner) {
    next();
    return;
  }

  const isSandboxKey = extractBearer(req)?.startsWith("pk_sandbox_") ?? false;
  if (partner.allowedOrigins.includes(origin) || (isSandboxKey && isLocalDevOrigin(origin))) {
    next();
    return;
  }

  const noWebsites = partner.allowedOrigins.length === 0;
  logEvent("auth.origin_rejected", {
    partnerId: partner._id,
    detail: { route: req.path, origin, reason: noWebsites ? "no_websites" : "not_listed" },
  });
  // CORS only lets listed origins read responses; this one is let through so the widget can
  // tell the partner why instead of the browser showing a bare network error
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.status(403).json({
    message: noWebsites
      ? "No website is registered for this API key. Add your website under Allowed websites in the Occubuy partner portal."
      : "This API key isn't allowed on this website. Add the site under Allowed websites in the Occubuy partner portal.",
    code: "ORIGIN_NOT_ALLOWED",
  });
}

// checks the per-flow token (X-Occubuy-Session header) against an already-loaded score:
// right token for this exact score and not expired. this is the part that actually stops
// someone with just the partner key from reading/sharing/declining a score that isn't theirs
export function sessionTokenMatches(
  scoreDoc: Pick<IUserScore, "sessionTokenHash" | "sessionTokenExpiresAt"> | null,
  token: string | undefined
): boolean {
  if (!token || !scoreDoc?.sessionTokenHash) return false;
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
// The score and the partner are read once, in parallel, and the score is handed to the route.
export function requireSessionAuth(req: Request, res: Response, next: NextFunction): void {
  const { scoreId } = req.params as { scoreId: string };
  Promise.all([findById<IUserScore>(USERSCORE_COLLECTION, scoreId), authenticatePartnerKey(req)])
    .then(([scoreDoc, partner]) => {
      if (!sessionTokenMatches(scoreDoc, sessionHeader(req))) {
        logEvent("auth.session_invalid", { scoreId, detail: { route: req.path } });
        res.status(401).json({ message: "Invalid or missing session token", code: "SESSION_INVALID" });
        return;
      }
      if (!partner) {
        res.status(401).json({ message: "Missing or invalid partner API key", code: "PARTNER_KEY_INVALID" });
        return;
      }
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
      req.scoreDoc = scoreDoc;
      next();
    })
    .catch(next);
}

export { sessionHeader };

