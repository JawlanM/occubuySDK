# Occubuy Partner Score SDK

Embeddable SDK for the Occubuy Partner Score — lets a partner 
drop a "Verify your rental score" widget directly into their own tenancy
application flow.

## Stack

- **TypeScript** — typed public API for partner integrators
- **tsup** (esbuild) — builds two output targets from one source:
  - `dist/occubuy-sdk.iife.js` — for `<script src="...">` embedding
  - `dist/index.esm.js` / `dist/index.cjs.js` — for `npm install`
- **Vitest** — unit tests
- **Playwright** — browser/E2E tests (needed once the iframe + postMessage
  flow is implemented — unit tests alone won't catch cross-frame bugs)
- **ESLint + Prettier** — linting/formatting
- **size-limit** — enforces the SDK bundle-size budget (10 KB gzipped, see
  `package.json`)
- **GitLab CI** — lint, typecheck, test, build, size-check on every push

## Getting started

\`\`\`bash
npm install
npm run dev      # watch mode build
npm run test     # unit tests
npm run lint      # eslint
npm run build     # production build (both targets)
npm run size      # check bundle-size budget
\`\`\`

## Branching / PR rules

- No self-merge to `main` — at least one reviewer required
- Feature branches off `main`, short-lived
- CI must pass (lint, typecheck, test, build, size) before merge

## Status

Early scaffold — public API (`OccubuyScore.init(...)`) is stubbed. Next up:
sandboxed iframe rendering, postMessage handshake with origin validation,
and the full state machine (Introduction → Bank connection → Processing →
Success / Error / Cancelled / Retry).
