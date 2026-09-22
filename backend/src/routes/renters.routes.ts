import { Router, Request, Response } from "express";
import { sendOtp, verifyOtp } from "../services/otp.service";

export const rentersRouter = Router();

const E164_RE = /^\+[1-9]\d{6,14}$/;

rentersRouter.post("/renters/send-otp", async (req: Request, res: Response) => {
  const { phone } = req.body ?? {};

  if (typeof phone !== "string" || !E164_RE.test(phone)) {
    return res.status(400).json({
      message: "phone must be in E.164 format, e.g. +61400000000",
      code: "INVALID_PHONE",
    });
  }

  await sendOtp(phone);

  return res.status(200).json({ status: "sent" });
});

rentersRouter.post("/renters/verify-otp", async (req: Request, res: Response) => {
  const { phone, code } = req.body ?? {};

  if (typeof phone !== "string" || typeof code !== "string") {
    return res.status(400).json({
      message: "phone and code are required",
      code: "INVALID_VERIFY_PAYLOAD",
    });
  }

  const result = await verifyOtp(phone, code);

  if (!result) {
    return res.status(401).json({
      message: "Code is invalid, expired, or already used",
      code: "OTP_INVALID",
    });
  }

  // This renterId is what the SDK should now send as the identity behind
  return res.status(200).json({ renterId: result.renterId });
});