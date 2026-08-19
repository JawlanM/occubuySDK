import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { UserScore, IUserScore } from "../models/userScore.model";

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


scoresRouter.post("/scores", async (req: Request, res: Response) => {
  const { userId } = req.body ?? {};

  if (!userId || typeof userId !== "string") {
    return res.status(400).json({
      message: "userId is required",
      code: "USER_ID_REQUIRED",
    });
  }

  const scoreDoc = await UserScore.create({ userId, status: "CREATED" });

  return res.status(201).json({
    scoreId: scoreDoc._id.toString(),
    fastlinkSession: {
      fastlinkUrl: "https://fastlink.example.test/authenticate/occubuy/fastlink",
      accessToken: "mock-access-token",
      configName: "Verification",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // Yodlee's token lifetime
    },
  });
});


scoresRouter.post("/scores/:scoreId/complete", async (req: Request, res: Response) => {
  const { scoreId } = req.params;
  const { providerId, providerAccountId, requestId, providerName, status, additionalStatus } =
    req.body ?? {};

  if (!mongoose.isValidObjectId(scoreId)) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  if (!providerAccountId || !requestId || status !== "SUCCESS") {
    return res.status(400).json({
      message: "providerAccountId, requestId, and status: 'SUCCESS' are required",
      code: "INVALID_COMPLETE_PAYLOAD",
    });
  }

  const scoreDoc = await UserScore.findById(scoreId);
  if (!scoreDoc) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  if (scoreDoc.status !== "CREATED") {
    return res.status(409).json({
      message: `Score is in status ${scoreDoc.status}, expected CREATED`,
      code: "INVALID_SCORE_STATE",
    });
  }

  scoreDoc.linkedAccount = { providerId, providerAccountId, requestId, providerName, additionalStatus };
  scoreDoc.status = "PROCESSING";
  await scoreDoc.save();

  return res.status(200).json({ status: "PROCESSING" });
});

scoresRouter.get("/scores/:scoreId", async (req: Request, res: Response) => {
  const { scoreId } = req.params;

  if (!mongoose.isValidObjectId(scoreId)) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  const scoreDoc = await UserScore.findById(scoreId);
  if (!scoreDoc) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  if (scoreDoc.status === "CREATED") {
    return res.status(200).json({ status: "PROCESSING", retryAfter: 3 });
  }

  if (scoreDoc.status === "PROCESSING") {
//swap this for real scoring engine
    const { value, band } = mockGenerateScore();
    scoreDoc.score = { value, band };
    scoreDoc.status = "COMPLETED";
    await scoreDoc.save();
  }

  if (scoreDoc.status === "COMPLETED") {
    return res.status(200).json({ status: "COMPLETED", score: scoreDoc.score });
  }

  // status === "FAILED"
  return res.status(200).json({ status: "FAILED" });
});