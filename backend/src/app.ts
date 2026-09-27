import express, { Request, Response, NextFunction } from "express";
import { scoresRouter } from "./routes/scores.routes";
import { fastlinkRouter } from "./routes/fastlink.routes";
import { partnerRouter } from "./routes/partner.routes";
import { internalRouter } from "./routes/internal.routes";
import { withdrawRouter } from "./routes/withdraw.routes";
import { rentersRouter } from "./routes/renters.routes";
import { findOne } from "./config/dataApi";
import { PARTNER_COLLECTION } from "./models/partner.model";
import { onPartnersChanged } from "./utils/partnerCache";

export const app = express();

// Render terminates TLS at the edge and forwards scheme via X-Forwarded-Proto; without
// this, req.protocol always reports "http" and breaks the fastlinkUrl we hand to the SDK.
app.set("trust proxy", 1);

// Server time per request, to compare before/after performance changes. Off in tests.
if (process.env.NODE_ENV !== "test") {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(`[timing] ${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });
}

// For an uptime pinger to keep the free Render instance awake. No DB work, no auth.
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).send("ok");
});

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

// On top of that list, any origin a partner registered in the portal (synced onto their
// partner record as allowedOrigins, see middleware/auth.ts requireAllowedOrigin). CORS only
// has to let the browser through here - which partner may use which origin is checked per
// key on POST /api/scores, so this just answers "is this origin anyone's?".
// Cached for a minute so it's not a DB round trip per request; cleared on every partner sync
// from the portal, so an added or removed domain applies straight away. Lookup errors aren't cached and fall back to "no".
const PARTNER_ORIGIN_CACHE_MS = 60_000;
const PARTNER_ORIGIN_CACHE_MAX = 1000;
const partnerOriginCache = new Map<string, { allowed: boolean; expiresAt: number }>();

async function isPartnerOrigin(origin: string): Promise<boolean> {
  const cached = partnerOriginCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;
  try {
    const allowed = Boolean(await findOne(PARTNER_COLLECTION, { allowedOrigins: origin }));
    // anyone can send any Origin, so don't let that grow the cache forever
    if (partnerOriginCache.size >= PARTNER_ORIGIN_CACHE_MAX) partnerOriginCache.clear();
    partnerOriginCache.set(origin, { allowed, expiresAt: Date.now() + PARTNER_ORIGIN_CACHE_MS });
    return allowed;
  } catch {
    return false;
  }
}

export function clearPartnerOriginCache(): void {
  partnerOriginCache.clear();
}
onPartnersChanged(clearPartnerOriginCache);

app.use(async (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Occubuy-Session");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  if (req.method === "OPTIONS") {
    // Preflight only asks "may I send this?". Any origin may send; which origin may use which
    // key is checked on the real request (requireAllowedOrigin), and that answers an unlisted
    // origin with a readable 403 instead of the browser blocking it before it's sent.
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.sendStatus(204);
    return;
  }
  if (origin && (ALLOWED_ORIGINS.includes(origin) || (await isPartnerOrigin(origin)))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  next();
});

app.use(express.json());

app.use("/api", scoresRouter);
app.use("/api", rentersRouter);
// before internalRouter: withdrawal has its own secret (the Occubuy app, not the portal)
app.use("/api/internal/scores", withdrawRouter);
app.use("/api/internal", internalRouter);
app.use(fastlinkRouter);
app.use(partnerRouter);