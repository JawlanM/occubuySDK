import { Router, Request, Response } from "express";
import { requirePartnerAuth } from "../middleware/auth";

export const partnerRouter = Router();

/**
 * GET /partners/config — lets the SDK fetch a partner's branding before it
 * renders, so the widget shows up already themed instead of flashing
 * default colours then swapping. Auth'd the same way /scores is: the
 * caller's own partner key determines whose config comes back, so there's
 * no separate :partnerId to guess in the URL.
 *
 * Per the requirement ("config fetch should not stop/fail the SDK
 * widget"): this endpoint always returns 200 with something usable, never
 * a bare error the widget has to interpret. Sensible built-in defaults if
 * a partner hasn't set branding, rather than null/undefined fields the
 * SDK would need special-case handling for. Genuine auth failures (bad
 * key) still 401 via requirePartnerAuth — the SDK's own responsibility
 * to fall back to defaults on *that* is a frontend concern, not this
 * endpoint's, but returning a clean, predictable shape on the happy path
 * is what we control from here.
 */
const DEFAULT_PRIMARY_COLOR = "#0F62FE";
const DEFAULT_LOGO_URL: string | null = null;

partnerRouter.get("/partners/config", requirePartnerAuth, (req: Request, res: Response) => {
  const branding = req.partner!.branding ?? {};

  return res.status(200).json({
    primaryColor: branding.primaryColor ?? DEFAULT_PRIMARY_COLOR,
    logoUrl: branding.logoUrl ?? DEFAULT_LOGO_URL,
  });
});