import express, { Request, Response, NextFunction } from "express";
import { scoresRouter } from "./routes/scores.routes";
import { fastlinkRouter } from "./routes/fastlink.routes";

export const app = express();

// Render (and most PaaS hosts) terminate TLS at their edge and forward the
// original scheme via X-Forwarded-Proto - without this, req.protocol always
// reports "http", which breaks the fastlinkUrl we hand back to the SDK
app.set("trust proxy", 1);

// no cors package, just doing it by hand - partner's site and this backend are different
// origins so fetch() needs these headers or the browser blocks it. same thing the old
// server.mjs was doing, just moved here now
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
app.use(fastlinkRouter);