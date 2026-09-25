import { Router, Request, Response } from "express";
import { requirePartnerAuth } from "../middleware/auth";

export const partnerRouter = Router();

/**
 * GET /partners/config - the widget calls this on start() to pick up the colours the partner
 * set in the portal ("Widget colours" on the Embed score page, synced here through
 * /api/internal/partners/sync). The caller's own key decides whose config comes back, so
 * there's no partner id to guess in the URL.
 *
 * Only returns what the partner actually set: an empty branding object means "use Occubuy's
 * colours", which the widget already has built in. The widget never waits on this - it draws
 * straight away and applies the colours when (if) they arrive.
 */
partnerRouter.get("/partners/config", requirePartnerAuth, (req: Request, res: Response) => {
  // short browser cache: a colour change shows up within a minute, without a call per page view
  res.setHeader("Cache-Control", "private, max-age=60");
  return res.status(200).json({ branding: req.partner!.branding });
});
