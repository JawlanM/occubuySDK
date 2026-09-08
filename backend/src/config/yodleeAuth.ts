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
export async function createYodleeFastLinkSession(): Promise<YodleeFastLinkSession> {
  const { accessToken, expiresIn } = await mintAccessToken();
  return {
    fastlinkUrl: FASTLINK_URL as string,
    accessToken,
    configName: CONFIG_NAME,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    transport: "yodleeJs",
  };
}
