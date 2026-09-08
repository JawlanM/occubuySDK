export type OccubuyEnvironment = "sandbox" | "production";

/**
 * Selects which backend supplies the FastLink session and receives the linked account.
 *
 * - `scoresApi` — the Occubuy Score API. The only mode that produces a score.
 * - `legacyDirect` — the Occubuy app's pre-existing `open-banking/*` endpoints, for
 *   end-to-end testing against the live Yodlee tenant before the Score API ships its
 *   Yodlee-shaped contract. These return no score, so the flow ends at "bank linked".
 *   Note they authenticate with the *app user's* JWT, so `sdkToken` must be the app user's token in this mode.
 */
export type OpenBankingMode = "scoresApi" | "legacyDirect";

export type ScoreBand =
  | "Excellent"
  | "Good"
  | "Fair"
  | "Poor"
  | "Insufficient Data";

export type ScoreStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export interface VerificationResult {
  scoreId: string;
  score: number;
  band: ScoreBand;
  customerId: string;
}

/**
 * Terminal result of `legacyDirect` mode, where no score is produced.
 */
export interface BankLinkResult {
  providerName?: string;
  providerAccountId?: number;
  requestId?: string;
}

export interface OccubuyError {
  code: string;
  message: string;
}

/**
 * How FastLink is launched.
 *
 * `postMessage` (default) is the SDK's own hand-built form-POST-into-an-iframe
 * approach — fine for the mock provider, but real Yodlee tenants' edge security
 * (Imperva) blocks it: verified 8-9 Sep 2026, a raw form POST gets "Error 15,
 * blocked by our security service" on every attempt (referrer policy and configName
 * both ruled out as the cause), while Yodlee's own official launch path — the
 * `initialize.js` script + `window.fastlink.open()` — works on the identical
 * account/credentials. `yodleeJs` is that official path; see `loadYodleeInitializeJs`
 * in `fastlink-embed.ts`.
 */
export type FastLinkTransport = "postMessage" | "yodleeJs";

/**
 * Everything needed to launch Yodlee FastLink 4.
 *
 * With `transport: "postMessage"` (or omitted), FastLink is a form POST target, not
 * a URL — `accessToken` and `extraParams` are submitted as form fields; see
 * `fastlink-form.ts`. With `transport: "yodleeJs"`, the backend has decided this
 * tenant needs the official `initialize.js` launch path instead.
 */
export interface FastLinkSession {
  /** The FastLink POST target / `fastLinkURL`. Accepts the `fastLinkUrl` / `url` aliases when decoding. */
  fastlinkUrl: string;
  /** Yodlee access token, without the `Bearer ` prefix. */
  accessToken: string;
  /** Yodlee tenant config name, submitted inside `extraParams` (postMessage) or `params` (yodleeJs). */
  configName?: string;
  /** Extra FastLink params merged in alongside `configName` and `intentUrl`. */
  extraParams?: Record<string, string>;
  /** When the Yodlee token expires. Yodlee tokens live 30 minutes. */
  expiresAt?: string;
  /** Defaults to `"postMessage"` when omitted, matching the mock provider's shape. */
  transport?: FastLinkTransport;
}

/**
 * The success payload FastLink reports for a linked institution.
 *
 * Shape mirrors an entry of `data.sites[]` in a `YWebViewHandler` message.
 */
export interface FastLinkSuccessPayload {
  providerId?: number;
  providerName?: string;
  requestId?: string;
  status?: string;
  additionalStatus?: string;
  providerAccountId?: number;
  fnToCall?: string;
}

export interface CreateScoreResponse {
  scoreId: string;
  fastlinkSession: FastLinkSession;
}

export interface CompleteScoreResponse {
  status: "PROCESSING";
}

export interface ScoreData {
  value: number;
  band: ScoreBand | string;
}

export interface GetScoreResponse {
  status: ScoreStatus;
  retryAfter?: number;
  score?: ScoreData;
}

/**
 * Raw shape of `GET open-banking/token` in `legacyDirect` mode.
 * `finappsUrl` is returned by the backend but unused.
 */
export interface LegacyOpenBankingTokenResponse {
  accessToken?: string;
  url?: string;
  finappsUrl?: string;
  configName?: string;
}
