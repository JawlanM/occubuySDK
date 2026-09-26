import { randomUUID } from "crypto";
import { findOne, updateById } from "../config/dataApi";
import { pushLeadToPortal } from "../config/portalClient";
import { IUserScore, USERSCORE_COLLECTION } from "../models/Userscore.model";
import { logEvent } from "../utils/auditLog";
import { scoreBand } from "../utils/band";

// Getting a shared score into the portal as a lead (dev plan 2.2). Before this, /share fired
// one push and if the portal was down the lead was just gone - the renter thinks they shared,
// the partner never sees it. Now:
//   - leadPushedAt on the score records that the portal actually has it
//   - each push is tried a few times with a short backoff
//   - retryPendingLeadPushes() (POST /api/internal/leads/retry, npm run leads:retry) re-pushes
//     every shared score the portal never confirmed
// The portal upserts leads on scoreId, so pushing the same one twice is harmless.
// None of this ever affects the renter's /share response.

type ShareableScore = Pick<IUserScore, "_id" | "partnerId" | "score" | "sharedAt"> &
  Partial<Pick<IUserScore, "applicant">>;

// retries after the first attempt; override with LEAD_PUSH_RETRY_DELAYS_MS="0,0" in tests
function retryDelays(): number[] {
  const configured = process.env.LEAD_PUSH_RETRY_DELAYS_MS;
  if (configured === undefined) return [1000, 5000];
  return configured
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function pushLeadWithRetry(scoreDoc: ShareableScore, delays: number[] = retryDelays()): Promise<boolean> {
  if (!scoreDoc.score || !scoreDoc.sharedAt) return false;

  const payload = {
    partnerId: scoreDoc.partnerId,
    scoreId: scoreDoc._id,
    score: scoreDoc.score.value,
    band: scoreBand(scoreDoc.score.value),
    verifiedAt: new Date(scoreDoc.sharedAt).toISOString(),
    // who shared it, for the partner's Shared scores tab. These came from the partner's own
    // application form (passed into the widget), so nothing the partner didn't already have.
    ...(scoreDoc.applicant
      ? {
          renter: {
            fullName: scoreDoc.applicant.fullName,
            email: scoreDoc.applicant.email,
            phone: scoreDoc.applicant.phone,
          },
        }
      : {}),
  };

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1] ?? 0);
    try {
      await pushLeadToPortal(payload);
    } catch {
      continue;
    }
    await updateById(USERSCORE_COLLECTION, scoreDoc._id, { leadPushedAt: new Date().toISOString() });
    return true;
  }

  logEvent("score.portal_sync_failed", {
    partnerId: scoreDoc.partnerId,
    scoreId: scoreDoc._id,
    detail: { attempts: delays.length + 1 },
  });
  return false;
}

const SWEEP_MAX = 500;

// Walks every shared score the portal hasn't confirmed and pushes it again, one attempt each
// (this is the catch-up after the portal was down, not the place to wait around).
// Uses findOne + a per-run marker instead of a "find many" so it works with the db-proxy's
// existing actions: each score gets stamped with this run's id before it's pushed, so the next
// findOne moves on to the next one whether the push worked or not. Declined scores are skipped.
export async function retryPendingLeadPushes(): Promise<{ pushed: number; failed: number }> {
  const sweepId = randomUUID();
  const result = { pushed: 0, failed: 0 };

  for (let i = 0; i < SWEEP_MAX; i++) {
    const scoreDoc = await findOne<IUserScore>(USERSCORE_COLLECTION, {
      sharedAt: { $ne: null },
      declinedAt: null,
      leadPushedAt: null,
      leadPushSweepId: { $ne: sweepId },
    });
    if (!scoreDoc) break;

    await updateById(USERSCORE_COLLECTION, scoreDoc._id, { leadPushSweepId: sweepId });
    if (await pushLeadWithRetry(scoreDoc, [])) result.pushed += 1;
    else result.failed += 1;
  }

  return result;
}
