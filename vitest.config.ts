import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "occubuy-score-sdk-claude-yodlee-fastlink-sdk-aarn1e/**",
    ],
  },
});
