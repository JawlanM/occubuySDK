import { defineConfig } from "tsup";

export default defineConfig([
  // For <script src="occubuy-sdk.js"> usage — a self-contained global
  {
    entry: { "occubuy-sdk.iife": "src/index.ts" },
    format: ["iife"],
    globalName: "OccubuyScore",
    minify: true,
    sourcemap: true,
    outDir: "dist",
  },
  // For `npm install @occubuy/score-sdk` usage
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    outDir: "dist",
    outExtension({ format }) {
      return { js: format === "esm" ? ".esm.js" : ".cjs.js" };
    },
  },
]);
