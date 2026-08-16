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
 * Everything needed to POST into Yodlee FastLink 4.
 *
 * FastLink is not a URL you navigate to — it is a form POST target. `accessToken`
 * and `extraParams` are submitted as form fields; see `fastlink-form.ts`.
 */
export interface FastLinkSession {
  /** The FastLink POST target. Accepts the `fastLinkUrl` / `url` aliases when decoding. */
  fastlinkUrl: string;
  /** Yodlee access token, without the `Bearer ` prefix. */
  accessToken: string;
  /** Yodlee tenant config name, submitted inside `extraParams`. */
  configName?: string;
  /** Extra FastLink params merged in alongside `configName` and `intentUrl`. */
  extraParams?: Record<string, string>;
  /** When the Yodlee token expires. Yodlee tokens live 30 minutes. */
  expiresAt?: string;
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
