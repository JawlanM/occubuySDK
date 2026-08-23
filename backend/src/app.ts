import express, { Request, Response, NextFunction } from "express";
import { scoresRouter } from "./routes/scores.routes";
import { fastlinkRouter } from "./routes/fastlink.routes";

export const app = express();

// Render terminates TLS at the edge and forwards scheme via X-Forwarded-Proto; without
// this, req.protocol always reports "http" and breaks the fastlinkUrl we hand to the SDK.
app.set("trust proxy", 1);

// Manual CORS (no cors package) - partner site and backend are different origins, so
// fetch() needs these headers or the browser blocks it.
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