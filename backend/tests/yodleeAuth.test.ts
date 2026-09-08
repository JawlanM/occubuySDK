import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Without this, yodleeAuth.ts's own `dotenv.config()` re-populates process.env from
// the real backend/.env on every resetModules()+reimport below, undoing setEnv({})
// and leaking whatever real YODLEE_* values happen to be configured on this machine
// into the "not configured" test cases. Only matters locally - CI has no .env file.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

const ENV_KEYS = [
  "YODLEE_API_BASE_URL",
  "YODLEE_CLIENT_ID",
  "YODLEE_SECRET",
  "YODLEE_LOGIN_NAME",
  "YODLEE_FASTLINK_URL",
  "YODLEE_CONFIG_NAME",
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

// yodleeAuth.ts reads env vars once at module load, same pattern as config/dataApi.ts -
// resetModules + a fresh dynamic import is how each test gets a clean read of process.env.
async function loadModule() {
  vi.resetModules();
  return import("../src/config/yodleeAuth");
}

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isYodleeConfigured", () => {
  it("is false when nothing is set", async () => {
    setEnv({});
    const { isYodleeConfigured } = await loadModule();
    expect(isYodleeConfigured()).toBe(false);
  });

  it("is false when only some vars are set", async () => {
    setEnv({ YODLEE_API_BASE_URL: "https://sandbox.preprod.yodlee.com/ysl", YODLEE_CLIENT_ID: "abc" });
    const { isYodleeConfigured } = await loadModule();
    expect(isYodleeConfigured()).toBe(false);
  });

  it("is true when all required vars are set", async () => {
    setEnv({
      YODLEE_API_BASE_URL: "https://sandbox.preprod.yodlee.com/ysl",
      YODLEE_CLIENT_ID: "client",
      YODLEE_SECRET: "secret",
      YODLEE_LOGIN_NAME: "sbMemtestuser",
      YODLEE_FASTLINK_URL: "https://fastlink.example.com/authenticate/x/fastlink/",
    });
    const { isYodleeConfigured } = await loadModule();
    expect(isYodleeConfigured()).toBe(true);
  });
});

describe("createYodleeFastLinkSession", () => {
  const CONFIG = {
    YODLEE_API_BASE_URL: "https://sandbox.preprod.yodlee.com/ysl",
    YODLEE_CLIENT_ID: "client-id",
    YODLEE_SECRET: "client-secret",
    YODLEE_LOGIN_NAME: "sbMemtestuser",
    YODLEE_FASTLINK_URL: "https://fastlink.example.com/authenticate/x/fastlink/",
    YODLEE_CONFIG_NAME: "Verification",
  };

  it("throws without calling fetch when not configured", async () => {
    setEnv({});
    const { createYodleeFastLinkSession } = await loadModule();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createYodleeFastLinkSession()).rejects.toThrow(/not fully configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints a real session on a successful token response", async () => {
    setEnv(CONFIG);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ token: { accessToken: "real-token-abc", issuedAt: "2026-09-08T00:00:00Z", expiresIn: 1799 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createYodleeFastLinkSession } = await loadModule();
    const session = await createYodleeFastLinkSession();

    expect(session.accessToken).toBe("real-token-abc");
    expect(session.fastlinkUrl).toBe(CONFIG.YODLEE_FASTLINK_URL);
    expect(session.configName).toBe("Verification");

    // the exact request shape Yodlee's token endpoint expects
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.preprod.yodlee.com/ysl/auth/token");
    expect(options.method).toBe("POST");
    expect(options.headers["Api-Version"]).toBe("1.1");
    expect(options.headers.loginName).toBe("sbMemtestuser");
    expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(options.body).toBe("clientId=client-id&secret=client-secret");
  });

  it("throws with the status and body on a non-ok response", async () => {
    setEnv(CONFIG);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"errorCode":"Y008","errorMessage":"Invalid clientId/secret"}'),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createYodleeFastLinkSession } = await loadModule();
    await expect(createYodleeFastLinkSession()).rejects.toThrow(/401/);
  });

  it("throws when the response has no accessToken", async () => {
    setEnv(CONFIG);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createYodleeFastLinkSession } = await loadModule();
    await expect(createYodleeFastLinkSession()).rejects.toThrow(/accessToken/);
  });
});
