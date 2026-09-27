import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "backend/src/**/*.ts", "backend/tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-console": "off",
    },
  },
  {
    // tests hand mocked records to typed functions; `as any` there is fine
    files: ["tests/**/*.ts", "backend/tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];
