import { Router, Request, Response } from "express";
import { IUserScore, USERSCORE_COLLECTION } from "../models/Userscore.model";
import {
  requirePartnerAuth,
  requireSessionAuth,
  verifySessionToken,
  authenticatePartnerKey,
  sessionHeader,
} from "../middleware/auth";
import { validateApplicant } from "../utils/validators";
import { generateSessionToken } from "../utils/crypto";
import { findById, insertOne, updateById, OBJECT_ID_RE } from "../config/dataApi";

export const scoresRouter = Router();

type ScoreBand = NonNullable<IUserScore["score"]>["band"];

function mockGenerateScore(): { value: number; band: ScoreBand } {
  const value = Math.floor(Math.random() * 1001);
  let band: ScoreBand;
  if (value >= 800) band = "Excellent";
  else if (value >= 600) band = "Good";
  else if (value >= 400) band = "Fair";
  else if (value >= 200) band = "Poor";
  else band = "Insufficient Data";
  return { value, band };
}


scoresRouter.post("/scores", requirePartnerAuth, async (req: Request, res: Response) => {
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

  const { token: sessionToken, hash: sessionTokenHash } = generateSessionToken();
  const now = new Date().toISOString();

  const scoreId = await insertOne(USERSCORE_COLLECTION, {
    userId,
    applicant: validated.applicant,
    status: "CREATED",
    sessionTokenHash,
    sharedAt: null,
    declinedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return res.status(201).json({
    scoreId,
    sessionToken,
    fastlinkSession: {
      fastlinkUrl: `${req.protocol}://${req.get("host")}/fastlink`,
      accessToken: "mock-access-token",
      configName: "Verification",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // Yodlee's token lifetime
    },
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

  return res.status(200).json({ status: "PROCESSING" });
});

// works two ways: SDK polls with the session token to check on its own in-progress score
// (any status, that's just the customer previewing their own result), or a partner's
// backend can hit this with its partner key instead - but that path only ever gets
// something back once sharedAt is set, i.e. after the customer actually clicked Share
scoresRouter.get("/scores/:scoreId", async (req: Request, res: Response) => {
  const { scoreId } = req.params;

  if (typeof scoreId !== "string" || !OBJECT_ID_RE.test(scoreId)) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  const hasValidSession = await verifySessionToken(scoreId, sessionHeader(req));
  const partner = hasValidSession ? null : await authenticatePartnerKey(req);

  if (!hasValidSession && !partner) {
    return res.status(401).json({ message: "Invalid or missing credentials", code: "AUTH_REQUIRED" });
  }

  const scoreDoc = await findById<IUserScore>(USERSCORE_COLLECTION, scoreId);
  if (!scoreDoc) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  // partner key alone isn't enough, has to actually be shared first
  if (partner && !scoreDoc.sharedAt) {
    return res.status(403).json({ message: "This score has not been shared by the customer", code: "NOT_SHARED" });
  }

  if (scoreDoc.status === "CREATED") {
    return res.status(200).json({ status: "PROCESSING", retryAfter: 3 });
  }

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
  }

  if (scoreDoc.status === "COMPLETED") {
    return res.status(200).json({ status: "COMPLETED", score: scoreDoc.score });
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
  }

  return res.status(200).json({
    score: scoreDoc.score.value,
    band: scoreDoc.score.band,
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
  }

  return res.status(200).json({ status: "declined" });
});
