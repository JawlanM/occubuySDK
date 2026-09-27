import { timingSafeEqual } from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { findById, updateOne, OBJECT_ID_RE } from "../config/dataApi";
import { IUserScore, USERSCORE_COLLECTION } from "../models/Userscore.model";
import { withdrawLeadWithRetry } from "../services/leadPush";
import { logEvent } from "../utils/auditLog";

// Withdrawal (plan P6 / E). The renter withdraws a score from the Occubuy mobile app, and the
// app's backend calls this. Not partner-facing and not the portal: it has its own secret,
// OCCUBUY_APP_SECRET, so a leaked portal secret can't withdraw scores and the other way round.
//
// Withdrawal deletes the renter's data and the score (decided 26 Sep). What's left is a
// tombstone with ids and dates only, so the portal can still be told if it missed the first
// notice (leadPush.ts sweep). Allowed until 12 months after the score was shared; after that
// the right to revoke has ended (decided 27 Sep) and it's a 409.
export const withdrawRouter = Router();

export const WITHDRAW_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

function requireAppSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.OCCUBUY_APP_SECRET ?? "";
  if (!expected) {
    // fail closed: no secret configured means nobody can call this
    res.status(503).json({ message: "Withdrawal isn't configured on this server", code: "NOT_CONFIGURED" });
    return;
  }
  const supplied = req.headers["x-app-secret"];
  const a = Buffer.from(typeof supplied === "string" ? supplied : "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ message: "Invalid app secret", code: "APP_SECRET_INVALID" });
    return;
  }
  next();
}

withdrawRouter.post("/:scoreId/withdraw", requireAppSecret, async (req: Request, res: Response) => {
  const scoreId = String(req.params.scoreId ?? "");
  if (!OBJECT_ID_RE.test(scoreId)) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }

  const scoreDoc = await findById<IUserScore>(USERSCORE_COLLECTION, scoreId);
  if (!scoreDoc) {
    return res.status(404).json({ message: "Score not found", code: "SCORE_NOT_FOUND" });
  }
  if (scoreDoc.status === "WITHDRAWN") {
    return res.status(200).json({ status: "withdrawn", withdrawnAt: scoreDoc.withdrawnAt, alreadyWithdrawn: true });
  }
  if (scoreDoc.sharedAt && Date.now() - Date.parse(scoreDoc.sharedAt) > WITHDRAW_WINDOW_MS) {
    return res.status(409).json({
      message: "This score was shared more than 12 months ago, so it can no longer be withdrawn",
      code: "WITHDRAWAL_WINDOW_CLOSED",
    });
  }

  const withdrawnAt = new Date().toISOString();
  const wiped = await updateOne(
    USERSCORE_COLLECTION,
    { _id: scoreId, status: { $ne: "WITHDRAWN" } },
    {
      $set: { status: "WITHDRAWN", withdrawnAt, updatedAt: withdrawnAt },
      $unset: { applicant: "", score: "", linkedAccount: "", userId: "", sessionTokenHash: "", sessionTokenExpiresAt: "" },
    }
  );
  if (wiped.matchedCount === 0) {
    // a parallel withdraw got there first
    return res.status(200).json({ status: "withdrawn", alreadyWithdrawn: true });
  }

  // ids only, nothing about the renter
  logEvent("score.closed", { partnerId: scoreDoc.partnerId, scoreId, detail: { reason: "withdrawn" } });

  // the partner only ever had it if it was shared; tell the portal to drop the lead
  if (scoreDoc.sharedAt) {
    withdrawLeadWithRetry({ _id: scoreId, partnerId: scoreDoc.partnerId }).catch(() => undefined);
  }

  return res.status(200).json({ status: "withdrawn", withdrawnAt });
});
