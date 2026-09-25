import { Router, Request, Response } from "express";
import { sendOtp, verifyOtp } from "../services/otp.service";
import { requireAllowedOrigin, requirePartnerAuth } from "../middleware/auth";
import { normalizeAuMobile } from "../utils/phone";

export const rentersRouter = Router();

// Both need a real partner key (and the partner's allowed-website check), same as starting
// a score: only a partner's widget should be able to make us send texts.
const partnerOnly = [requirePartnerAuth, requireAllowedOrigin];

const INVALID_PHONE = {
  message: "Enter a valid Australian mobile number, e.g. 04XX XXX XXX.",
  code: "INVALID_PHONE",
};

rentersRouter.post("/renters/send-otp", ...partnerOnly, async (req: Request, res: Response) => {
  const phone = normalizeAuMobile(req.body?.phone);
  if (!phone) return res.status(400).json(INVALID_PHONE);

  const result = await sendOtp(phone, req.partner!._id);
  if (!result.ok) {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    return res.status(429).json({
      message: "Too many codes sent to this number. Please wait before asking for another.",
      code: "OTP_RATE_LIMITED",
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }

  return res.status(200).json({ status: "sent" });
});

rentersRouter.post("/renters/verify-otp", ...partnerOnly, async (req: Request, res: Response) => {
  const phone = normalizeAuMobile(req.body?.phone);
  const code = req.body?.code;
  if (!phone) return res.status(400).json(INVALID_PHONE);
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: "Enter the 6-digit code.", code: "INVALID_VERIFY_PAYLOAD" });
  }

  const result = await verifyOtp(phone, code, req.partner!._id);
  if (!result.ok) {
    if (result.reason === "too_many_attempts") {
      return res.status(429).json({
        message: "Too many wrong codes. Ask for a new code.",
        code: "OTP_TOO_MANY_ATTEMPTS",
      });
    }
    return res.status(401).json({
      message: "Code is invalid, expired, or already used",
      code: "OTP_INVALID",
    });
  }

  // This renterId is what the SDK should now send as the identity behind
  return res.status(200).json({ renterId: result.renterId });
});
