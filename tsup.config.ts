import { defineConfig } from "tsup";

export default defineConfig([
  // this build is for the <script src="occubuy-sdk.js"> way of using it, just one global
  {
    entry: { "occubuy-sdk.iife": "src/index.ts" },
    format: ["iife"],
    globalName: "OccubuyScore",
    minify: true,
    sourcemap: true,
    outDir: "dist",
  },
  // this build is for people who npm install @occubuy/score-sdk instead
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
