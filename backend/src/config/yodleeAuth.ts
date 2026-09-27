import dotenv from "dotenv";

dotenv.config();

// Real Yodlee sandbox token minting - only active when BANK_PROVIDER=yodlee and the vars
// below are set (see backend/.env.example). Falls back to the mock provider otherwise, so
// existing tests/CI/local dev without Yodlee credentials are unaffected.
const API_BASE_URL = process.env.YODLEE_API_BASE_URL;
const CLIENT_ID = process.env.YODLEE_CLIENT_ID;
const SECRET = process.env.YODLEE_SECRET;
// A sandbox TEST USER's loginName, never the admin one - Yodlee's own Postman guide warns
// the admin account doesn't authenticate correctly for this call.
const LOGIN_NAME = process.env.YODLEE_LOGIN_NAME;
const FASTLINK_URL = process.env.YODLEE_FASTLINK_URL;
const CONFIG_NAME = process.env.YODLEE_CONFIG_NAME;

const REQUEST_TIMEOUT_MS = 8000;

export function isYodleeConfigured(): boolean {
  return Boolean(API_BASE_URL && CLIENT_ID && SECRET && LOGIN_NAME && FASTLINK_URL);
}

function ensureConfigured(): void {
  if (!isYodleeConfigured()) {
    throw new Error(
      "Yodlee sandbox is not fully configured - YODLEE_API_BASE_URL, YODLEE_CLIENT_ID, " +
        "YODLEE_SECRET, YODLEE_LOGIN_NAME and YODLEE_FASTLINK_URL must all be set. See backend/.env.example."
    );
  }
}

interface YodleeTokenResponse {
  token: {
    accessToken: string;
    issuedAt: string;
    expiresIn: number;
  };
}

export interface YodleeFastLinkSession {
  fastlinkUrl: string;
  accessToken: string;
  configName?: string | undefined;
  expiresAt: string;
  // Real Yodlee tenants' edge security (Imperva) blocks the SDK's hand-built form
  // POST with "Error 15" - verified 8-9 Sep 2026 against a real sandbox account.
  // Yodlee's own official launch path (initialize.js + window.fastlink.open())
  // works on the identical credentials, so real sessions set this to "yodleeJs";
  // the mock (scores.routes.ts) stays "postMessage" - it has no real WAF to trip.
  transport?: "postMessage" | "yodleeJs";
}

// POST {API_BASE_URL}/auth/token - mints a real, short-lived Yodlee access token scoped to
// LOGIN_NAME. Server-side only; CLIENT_ID/SECRET never reach the browser.
async function mintAccessToken(): Promise<{ accessToken: string; expiresIn: number }> {
  ensureConfigured();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/auth/token`, {
      method: "POST",
      headers: {
        "Api-Version": "1.1",
        loginName: LOGIN_NAME as string,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        clientId: CLIENT_ID as string,
        secret: SECRET as string,
      }).toString(),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(`Yodlee token request failed to reach ${API_BASE_URL}: ${String(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Yodlee token request failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as YodleeTokenResponse;
  if (!data?.token?.accessToken) {
    throw new Error("Yodlee token response was missing token.accessToken");
  }
  return { accessToken: data.token.accessToken, expiresIn: data.token.expiresIn };
}

// Called from POST /scores to build a real fastlinkSession, the same shape the mock
// provider already returns - so the SDK-side code needs no changes either way.
// The token is for the configured Yodlee user, not per renter, so one token serves every
// session until it's close to expiring. A renter always gets one with at least 10 minutes left,
// so FastLink can't expire halfway through their bank login.
const MIN_TOKEN_LIFE_MS = 10 * 60 * 1000;
let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

export function clearYodleeTokenCache(): void {
  cachedToken = null;
}

async function userToken(): Promise<{ accessToken: string; expiresAtMs: number }> {
  if (!cachedToken || cachedToken.expiresAtMs - Date.now() < MIN_TOKEN_LIFE_MS) {
    const { accessToken, expiresIn } = await mintAccessToken();
    cachedToken = { accessToken, expiresAtMs: Date.now() + expiresIn * 1000 };
  }
  return cachedToken;
}

export async function createYodleeFastLinkSession(): Promise<YodleeFastLinkSession> {
  const token = await userToken();
  return {
    fastlinkUrl: FASTLINK_URL as string,
    accessToken: token.accessToken,
    configName: CONFIG_NAME,
    expiresAt: new Date(token.expiresAtMs).toISOString(),
    transport: "yodleeJs",
  };
}

// /complete asks Yodlee whether the bank link the browser reported really exists for our user,
// instead of trusting the widget's word for it. GET /providerAccounts/{id} answers
// { providerAccount: [{ id, status, providerId, ... }] }, and HTTP 400 with errorCode Y807 for an
// id this user doesn't have (checked against the sandbox, 27 Sep).
// "failed" = the link exists but Yodlee says it failed. Throws when Yodlee can't be reached, so
// the caller can say "try again" instead of rejecting a renter whose bank link is fine.
export type ProviderAccountCheck = "ok" | "not_found" | "failed" | "provider_mismatch";

export async function confirmProviderAccount(providerAccountId: number | string, providerId?: number | string): Promise<ProviderAccountCheck> {
  ensureConfigured();
  const { accessToken } = await userToken();
  const res = await fetch(`${API_BASE_URL}/providerAccounts/${encodeURIComponent(String(providerAccountId))}`, {
    headers: { "Api-Version": "1.1", Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 400 || res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { errorCode?: string };
    if (res.status === 404 || body.errorCode === "Y807") return "not_found";
  }
  if (!res.ok) throw new Error(`Yodlee providerAccounts check failed: HTTP ${res.status}`);
  const body = (await res.json()) as { providerAccount?: Array<{ status?: string; providerId?: number }> };
  const account = body.providerAccount?.[0];
  if (!account) return "not_found";
  if (account.status === "FAILED") return "failed";
  if (providerId !== undefined && account.providerId !== undefined && String(account.providerId) !== String(providerId)) {
    return "provider_mismatch";
  }
  return "ok";
}
