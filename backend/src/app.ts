import express, { Request, Response, NextFunction } from "express";
import { scoresRouter } from "./routes/scores.routes";
import { fastlinkRouter } from "./routes/fastlink.routes";
import { partnerRouter } from "./routes/partner.routes";
import { internalRouter } from "./routes/internal.routes";
import { rentersRouter } from "./routes/renters.routes";

export const app = express();

// Render terminates TLS at the edge and forwards scheme via X-Forwarded-Proto; without
// this, req.protocol always reports "http" and breaks the fastlinkUrl we hand to the SDK.
app.set("trust proxy", 1);

// Manual CORS (no cors package) - partner site and backend are different origins, so
// fetch() needs these headers or the browser blocks it.
//
// Reflects the Origin header only if it's on the allowlist below, instead of "*" for
// everyone. Set ALLOWED_ORIGINS (comma-separated) in the environment to override/extend
// this for real partner domains - see backend/.env.example.
//
// Note this only stops a stranger's *browser JavaScript* from calling the API cross-site.
// It does nothing against a direct server-to-server or curl/Postman request, since CORS is
// enforced by browsers reading response headers, not by the server refusing the request.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://occubuy-demo.onrender.com",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Occubuy-Session");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());

app.use("/api", scoresRouter);
app.use("/api", rentersRouter);
app.use("/api/internal", internalRouter);
app.use(fastlinkRouter);
app.use(partnerRouter);