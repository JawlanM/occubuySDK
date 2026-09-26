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
  // the hosted copy partners embed: <script src="https://occubuy-demo.onrender.com/sdk/v1/occubuy-sdk.js">
  // (the Render static site serves this repo, so this lands there on every deploy).
  // Same code as above, but defaults to the deployed backend so the snippet needs no apiBase.
  // v1 = only changes that don't break a partner's existing snippet. Anything breaking goes
  // to sdk/v2 and v1 keeps working.
  {
    entry: { "occubuy-sdk": "src/index.ts" },
    format: ["iife"],
    globalName: "OccubuyScore",
    minify: true,
    sourcemap: true,
    outDir: "sdk/v1",
    outExtension: () => ({ js: ".js" }),
    define: {
      __OCCUBUY_DEFAULT_API_BASE__: JSON.stringify(
        process.env.OCCUBUY_API_BASE ?? "https://occubuy-backend.onrender.com"
      ),
    },
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
