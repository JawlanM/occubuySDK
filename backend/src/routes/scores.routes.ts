import { Router, Request, Response } from "express";
import { IUserScore, USERSCORE_COLLECTION } from "../models/Userscore.model";
import {
  requirePartnerAuth,
  requireAllowedOrigin,
  requireSessionAuth,
  verifySessionToken,
  authenticatePartnerKey,
  sessionHeader,
} from "../middleware/auth";
import { validateApplicant } from "../utils/validators";
import { generateSessionToken } from "../utils/crypto";
import { findById, insertOne, updateById, OBJECT_ID_RE } from "../config/dataApi";
import { logEvent } from "../utils/auditLog";
import { createYodleeFastLinkSession, isYodleeConfigured, YodleeFastLinkSession } from "../config/yodleeAuth";
import { pushLeadWithRetry } from "../services/leadPush";
import { scoreBand, type ScoreBand } from "../utils/band";

export const scoresRouter = Router();

const SESSION_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour - long enough for a real flow, short enough to bound a leak

// Real scoring isn't this team's job (decided 26 Sep) - Occubuy swaps their scorer in here.
function mockGenerateScore(): { value: number; band: ScoreBand } {
  const value = Math.floor(Math.random() * 1001);
  return { value, band: scoreBand(value) };
}

// BANK_PROVIDER=yodlee (and every YODLEE_* var set) mints a real sandbox FastLink session.
// Anything else - unset, CI, tests, no credentials - keeps the existing mock unchanged.
// Real minting can fail (network, bad creds); falls back to the mock rather than 500ing
// the whole /scores call, since this is sandbox testing, not a path anything depends on yet.
async function buildFastLinkSession(req: Request): Promise<YodleeFastLinkSession> {
  const wantsReal = process.env.BANK_PROVIDER === "yodlee" && isYodleeConfigured();
  if (wantsReal) {
    try {
      return await createYodleeFastLinkSession();
    } catch (error) {
      console.error("Yodlee session mint failed, falling back to mock:", error);
    }
  }
  return {
    fastlinkUrl: `${req.protocol}://${req.get("host")}/fastlink`,
    accessToken: "mock-access-token",
    configName: "Aggregation",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // Yodlee's token lifetime
    transport: "postMessage",
  };
}


scoresRouter.post("/scores", requirePartnerAuth, requireAllowedOrigin, async (req: Request, res: Response) => {
  const { userId, applicant } = req.body ?? {};

  if (!userId || typeof userId !== "string") {
    return res.status(400).json({
      message: "userId is required",
      code: "USER_ID_REQUIRED",
    });
  }

  const validated = validateApplicant(applicant ?? {});
  if (!validated.ok) {
    return res.status(400).json({
      message: "One or more applicant fields are invalid",
      code: "INVALID_APPLICANT",
      errors: validated.errors,
    });
  }


  //runs once your inside  POST / scores
  const { token: sessionToken, hash: sessionTokenHash } = generateSessionToken();
  const now = new Date().toISOString();
  const sessionTokenExpiresAt = new Date(Date.now() + SESSION_TOKEN_TTL_MS).toISOString();

  const scoreId = await insertOne(USERSCORE_COLLECTION, {
    userId,
    partnerId: req.partner!._id,
    applicant: validated.applicant,
    status: "CREATED",
    sessionTokenHash,
    sessionTokenExpiresAt,
    sharedAt: null,
    declinedAt: null,
    leadPushedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  logEvent("score.created", { partnerId: req.partner!._id, scoreId });

  return res.status(201).json({
    scoreId,
    sessionToken,
    fastlinkSession: await buildFastLinkSession(req),
  });
});


scoresRouter.post("/scores/:scoreId/complete", requireSessionAuth, async (req: Request, res: Response) => {
  const scoreId = String(req.params.scoreId ?? "");
  const { providerId, providerAccountId, requestId, providerName, status, additionalStatus } =
    req.body ?? {};

  if (!OBJECT_ID_RE.test(scoreId)) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  if (!providerAccountId || !requestId || status !== "SUCCESS") {
    return res.status(400).json({
      message: "providerAccountId, requestId, and status: 'SUCCESS' are required",
      code: "INVALID_COMPLETE_PAYLOAD",
    });
  }


  //step 2, renter connects their bank
  const scoreDoc = await findById<IUserScore>(USERSCORE_COLLECTION, scoreId);
  if (!scoreDoc) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  if (scoreDoc.status !== "CREATED") {
    return res.status(409).json({
      message: `Score is in status ${scoreDoc.status}, expected CREATED`,
      code: "INVALID_SCORE_STATE",
    });
  }

  await updateById(USERSCORE_COLLECTION, scoreId, {
    linkedAccount: { providerId, providerAccountId, requestId, providerName, additionalStatus },
    status: "PROCESSING",
    updatedAt: new Date().toISOString(),
  });

  logEvent("score.bank_connected", { partnerId: scoreDoc.partnerId, scoreId, detail: { providerName } });

  return res.status(200).json({ status: "PROCESSING" });
});

// works two ways: SDK polls with the session token to check on its own in-progress score
// (any status, that's just the customer previewing their own result), or a partner's
// backend can hit this with its partner key instead - but that path only ever gets
// something back once sharedAt is set, i.e. after the customer actually clicked Share
//
// SECURITY FIX (29 Aug): previously, a valid session token alone skipped the partner-
// ownership check entirely, so a session token for one partner's score could be replayed
// alongside a *different* partner's API key (or no key at all) and still return the score.
// The partner key is now always checked and always has to match the score's own partnerId,
// regardless of whether a session token is also present - closing that gap. This doesn't
// change real usage: the SDK always sends its partner key on every request already.
scoresRouter.get("/scores/:scoreId", async (req: Request, res: Response) => {
  const { scoreId } = req.params;

  if (typeof scoreId !== "string" || !OBJECT_ID_RE.test(scoreId)) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  const hasValidSession = await verifySessionToken(scoreId, sessionHeader(req));
  const partner = await authenticatePartnerKey(req);

  if (!partner) {
    logEvent("auth.partner_key_invalid", { scoreId, detail: { route: "GET /scores/:scoreId" } });
    return res.status(401).json({ message: "Invalid or missing credentials", code: "AUTH_REQUIRED" });
  }

  const scoreDoc = await findById<IUserScore>(USERSCORE_COLLECTION, scoreId);
  if (!scoreDoc) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  // 404, not 403: don't confirm the score exists for a different partner. Checked first,
  // and unconditionally - a matching session token no longer bypasses this.
  if (scoreDoc.partnerId !== partner._id) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  // Same partner, but no valid session for this exact score: only allowed in once the
  // customer has actually clicked Share.
  if (!hasValidSession && !scoreDoc.sharedAt) {
    return res.status(403).json({ message: "This score has not been shared by the customer", code: "NOT_SHARED" });
  }

  if (scoreDoc.status === "CREATED") {
    return res.status(200).json({ status: "PROCESSING", retryAfter: 3 });
  }



  //step 3, widget polls GET /score{id} to check progress
  if (scoreDoc.status === "PROCESSING") {
    // swap this for real scoring engine
    const { value, band } = mockGenerateScore();
    await updateById(USERSCORE_COLLECTION, scoreId, {
      score: { value, band },
      status: "COMPLETED",
      updatedAt: new Date().toISOString(),
    });
    scoreDoc.score = { value, band };
    scoreDoc.status = "COMPLETED";
    logEvent("score.completed", { partnerId: scoreDoc.partnerId, scoreId, detail: { band } });
  }

  if (scoreDoc.status === "COMPLETED" && scoreDoc.score) {
    // band always recomputed, so scores stored under the old band names read the same as new ones
    const { value } = scoreDoc.score;
    return res.status(200).json({ status: "COMPLETED", score: { value, band: scoreBand(value) } });
  }

  // status === "FAILED"
  return res.status(200).json({ status: "FAILED" });
});

// hits when the customer clicks "Share with Partner". this is the only place that
// actually flips sharedAt - GET above won't hand anything to a partner until this ran
scoresRouter.post("/scores/:scoreId/share", requireSessionAuth, async (req: Request, res: Response) => {
  const scoreId = String(req.params.scoreId ?? "");

  const scoreDoc = await findById<IUserScore>(USERSCORE_COLLECTION, scoreId);
  if (!scoreDoc) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  if (scoreDoc.declinedAt) {
    return res.status(409).json({ message: "This score was already declined", code: "ALREADY_DECLINED" });
  }

  if (scoreDoc.status !== "COMPLETED" || !scoreDoc.score) {
    return res.status(409).json({
      message: `Score is in status ${scoreDoc.status}, expected COMPLETED`,
      code: "INVALID_SCORE_STATE",
    });
  }

  let sharedAt = scoreDoc.sharedAt;
  if (!sharedAt) {
    sharedAt = new Date().toISOString();
    await updateById(USERSCORE_COLLECTION, scoreId, { sharedAt, updatedAt: new Date().toISOString() });
    logEvent("score.shared", { partnerId: scoreDoc.partnerId, scoreId });
  }

  // The portal catches this as a "lead" for the partner's dashboard. Fire-and-forget with a
  // few retries (services/leadPush.ts) - never affects the response below, the customer
  // already has their result either way. Also re-pushes if /share gets called again for a
  // score the portal never confirmed; the portal upserts on scoreId so that's harmless.
  if (!scoreDoc.leadPushedAt) {
    pushLeadWithRetry({ ...scoreDoc, sharedAt }).catch(() => undefined);
  }

  return res.status(200).json({
    score: scoreDoc.score.value,
    band: scoreBand(scoreDoc.score.value),
    verifiedAt: new Date(sharedAt).toISOString(),
    reference: scoreDoc._id,
  });
});

// hits when the customer clicks "Don't share". once this is set, /share above is
// locked out for good even if something later tries to call it again
scoresRouter.post("/scores/:scoreId/decline", requireSessionAuth, async (req: Request, res: Response) => {
  const scoreId = String(req.params.scoreId ?? "");

  const scoreDoc = await findById<IUserScore>(USERSCORE_COLLECTION, scoreId);
  if (!scoreDoc) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  if (!scoreDoc.declinedAt) {
    await updateById(USERSCORE_COLLECTION, scoreId, {
      declinedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    logEvent("score.declined", { partnerId: scoreDoc.partnerId, scoreId });
  }

  return res.status(200).json({ status: "declined" });
});
