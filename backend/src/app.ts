import express from "express";
import { scoresRouter } from "./routes/scores.routes";

export const app = express();

app.use(express.json());

app.use(scoresRouter);