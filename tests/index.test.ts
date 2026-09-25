import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init, type OccubuyApplicant } from "../src/index";

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  el.id = "occubuy-widget";
  document.body.appendChild(el);
  return el;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

// Matches what POST /scores actually returns now (backend/src/routes/scores.routes.ts) -
// a real FastLink session, not a placeholder the SDK ignores.
const FASTLINK_SESSION = {
  fastlinkUrl: "http://localhost:8787/fastlink",
  accessToken: "mock-access-token",
  configName: "Verification",
};

// Real FastLink 4 success shape: a POST_MESSAGE envelope with data.sites[], matching
// src/fastlink/fastlink-events.ts's parsing.
function fastLinkSuccessMessage(site: Record<string, unknown>) {
  return {
    type: "POST_MESSAGE",
    data: { sites: [site] },
  };
}

// same shape the mock partner form collects - see demo/mockPartnerWebApp.html
const VALID_APPLICANT: OccubuyApplicant = {
  fullName: "Jordan Lee",
  email: "jordan@email.com",
  phone: "0412 345 678",
  dob: "1998-04-12",
  address: "12 Example St, Sydney NSW 2000",
};

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OccubuyScore.init", () => {
  it("throws without an apiKey", () => {
    // @ts-expect-error leaving out apiKey on purpose for this test
    expect(() => init({ container: makeContainer(), applicant: VALID_APPLICANT })).toThrow();
  });

  it("throws without a container", () => {
    // @ts-expect-error leaving out container on purpose for this test
    expect(() => init({ apiKey: "pk_sandbox_test", applicant: VALID_APPLICANT })).toThrow();
  });

  it("throws without applicant details", () => {
    // @ts-expect-error leaving out applicant on purpose for this test
    expect(() => init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget" })).toThrow();
  });

  it("returns a start() function and renders the consent step into the container", () => {
    const container = makeContainer();
    const instance = init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget", applicant: VALID_APPLICANT });
    expect(typeof instance.start).toBe("function");

    instance.start();

    expect(container.querySelector('[data-occubuy-step="consent"]')).not.toBeNull();
    expect(container.querySelector("[data-occubuy-consent-checkbox]")).not.toBeNull();
    expect(container.querySelector("[data-occubuy-consent-submit]")).not.toBeNull();
    // the styles should only get added once, and everything should be occubuy- prefixed
    expect(document.getElementById("occubuy-style")).not.toBeNull();
  });

  it("renders the consent checkbox and submit button on a single screen, with no panel-stepping controls", () => {
    const container = makeContainer();
    const instance = init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget", applicant: VALID_APPLICANT });
    instance.start();

    expect(container.querySelector("[data-occubuy-consent-checkbox]")).not.toBeNull();
    expect(container.querySelector("[data-occubuy-consent-submit]")).not.toBeNull();
    expect(container.querySelector("[data-occubuy-panel-next]")).toBeNull();
    expect(container.querySelector("[data-occubuy-panel-back]")).toBeNull();
  });

  it("applies branding colours to the container as CSS custom properties", () => {
    const container = makeContainer();
    const instance = init({
      apiKey: "pk_sandbox_test",
      container: "#occubuy-widget",
      applicant: VALID_APPLICANT,
      branding: { primaryColor: "#123456", headingColor: "#abcdef" },
    });
    instance.start();

    expect(container.style.getPropertyValue("--occubuy-accent")).toBe("#123456");
    expect(container.style.getPropertyValue("--occubuy-heading")).toBe("#abcdef");
  });

  it("drives consent -> bank connection -> score through to onComplete", async () => {
    const container = makeContainer();

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/scores")) {
        return Promise.resolve(
          jsonResponse({ scoreId: "score_123", sessionToken: "test-session-token", fastlinkSession: FASTLINK_SESSION })
        );
      }
      if (url.endsWith("/api/scores/score_123/complete")) {
        return Promise.resolve(jsonResponse({ status: "PROCESSING" }));
      }
      if (url.endsWith("/api/scores/score_123")) {
        return Promise.resolve(jsonResponse({ status: "COMPLETED", score: { value: 822 } }));
      }
      if (url.endsWith("/api/scores/score_123/share")) {
        return Promise.resolve(
          jsonResponse({ score: 822, verifiedAt: "2026-08-18T00:00:00.000Z", reference: "score_123" })
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const onComplete = vi.fn();
    const instance = init({
      apiKey: "pk_sandbox_test",
      container: "#occubuy-widget",
      applicant: VALID_APPLICANT,
      onComplete,
      onCancel: vi.fn(),
    });
    instance.start();

    // fill out consent and submit it
    const checkbox = container.querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    container.querySelector<HTMLButtonElement>("[data-occubuy-consent-submit]")!.click();

    await vi.waitFor(() => {
      expect(container.querySelector('[data-occubuy-step="bankConnection"]')).not.toBeNull();
    });

    // pretend the embedded iframe sent back a real FastLink success message
    const iframe = container.querySelector<HTMLIFrameElement>("[data-occubuy-fastlink-iframe]")!;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: fastLinkSuccessMessage({
          providerId: 16442,
          providerAccountId: 12345678,
          requestId: "req_1",
          providerName: "ANZ",
          status: "SUCCESS",
        }),
        origin: "http://localhost:8787",
        source: iframe.contentWindow,
      })
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "POST_MESSAGE", data: { action: "exit", sites: [] } },
        origin: "http://localhost:8787",
        source: iframe.contentWindow,
      })
    );

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(0); // shouldn't fire yet, still needs the Share click
      expect(container.querySelector('[data-occubuy-score-value]')).not.toBeNull();
    });

    expect(container.querySelector("[data-occubuy-score-value]")?.textContent).toBe("822");
    expect(container.querySelector("[data-occubuy-score-band]")?.textContent).toBe("Strong");

    const shareBtn = container.querySelector<HTMLButtonElement>("[data-occubuy-share]")!;
    shareBtn.click();

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "success",
          score: 822,
          band: "strong",
          verifiedAt: "2026-08-18T00:00:00.000Z",
          reference: "score_123",
        })
      );
    });

    // onComplete's payload came from POST .../share's response, not from the score already
    // sitting in memory from polling - proven by asserting share was actually called.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/scores/score_123/share"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("does not fire onComplete twice on a rapid double-click of Share", async () => {
    const container = makeContainer();

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/scores")) {
        return Promise.resolve(
          jsonResponse({ scoreId: "score_789", sessionToken: "test-session-token", fastlinkSession: FASTLINK_SESSION })
        );
      }
      if (url.endsWith("/api/scores/score_789/complete")) {
        return Promise.resolve(jsonResponse({ status: "PROCESSING" }));
      }
      if (url.endsWith("/api/scores/score_789")) {
        return Promise.resolve(jsonResponse({ status: "COMPLETED", score: { value: 500 } }));
      }
      if (url.endsWith("/api/scores/score_789/share")) {
        return Promise.resolve(jsonResponse({ score: 500, verifiedAt: "2026-08-18T00:00:00.000Z", reference: "score_789" }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const onComplete = vi.fn();
    const instance = init({
      apiKey: "pk_sandbox_test",
      container: "#occubuy-widget",
      applicant: VALID_APPLICANT,
      onComplete,
    });
    instance.start();

    container.querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!.checked = true;
    container
      .querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!
      .dispatchEvent(new Event("change"));
    container.querySelector<HTMLButtonElement>("[data-occubuy-consent-submit]")!.click();

    await vi.waitFor(() => {
      expect(container.querySelector('[data-occubuy-step="bankConnection"]')).not.toBeNull();
    });

    const iframe = container.querySelector<HTMLIFrameElement>("[data-occubuy-fastlink-iframe]")!;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: fastLinkSuccessMessage({
          providerId: 16442,
          providerAccountId: 22334455,
          requestId: "req_2",
          providerName: "ANZ",
          status: "SUCCESS",
        }),
        origin: "http://localhost:8787",
        source: iframe.contentWindow,
      })
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "POST_MESSAGE", data: { action: "exit", sites: [] } },
        origin: "http://localhost:8787",
        source: iframe.contentWindow,
      })
    );

    await vi.waitFor(() => {
      expect(container.querySelector('[data-occubuy-score-value]')).not.toBeNull();
    });

    const shareBtn = container.querySelector<HTMLButtonElement>("[data-occubuy-share]")!;
    shareBtn.click();
    shareBtn.click();
    shareBtn.click();

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it("declining on the score screen fires onDecline and never calls onComplete", async () => {
    const container = makeContainer();

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/scores")) {
        return Promise.resolve(
          jsonResponse({ scoreId: "score_456", sessionToken: "test-session-token", fastlinkSession: FASTLINK_SESSION })
        );
      }
      if (url.endsWith("/api/scores/score_456/complete")) {
        return Promise.resolve(jsonResponse({ status: "PROCESSING" }));
      }
      if (url.endsWith("/api/scores/score_456")) {
        return Promise.resolve(jsonResponse({ status: "COMPLETED", score: { value: 259 } }));
      }
      if (url.endsWith("/api/scores/score_456/decline")) {
        return Promise.resolve(jsonResponse({ status: "declined" }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const onComplete = vi.fn();
    const onDecline = vi.fn();
    const instance = init({
      apiKey: "pk_sandbox_test",
      container: "#occubuy-widget",
      applicant: VALID_APPLICANT,
      onComplete,
      onDecline,
    });
    instance.start();

    container.querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!.checked = true;
    container
      .querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!
      .dispatchEvent(new Event("change"));
    container.querySelector<HTMLButtonElement>("[data-occubuy-consent-submit]")!.click();

    await vi.waitFor(() => {
      expect(container.querySelector('[data-occubuy-step="bankConnection"]')).not.toBeNull();
    });

    const iframe = container.querySelector<HTMLIFrameElement>("[data-occubuy-fastlink-iframe]")!;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: fastLinkSuccessMessage({
          providerId: 16442,
          providerAccountId: 33445566,
          requestId: "req_3",
          providerName: "ANZ",
          status: "SUCCESS",
        }),
        origin: "http://localhost:8787",
        source: iframe.contentWindow,
      })
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "POST_MESSAGE", data: { action: "exit", sites: [] } },
        origin: "http://localhost:8787",
        source: iframe.contentWindow,
      })
    );

    await vi.waitFor(() => {
      expect(container.querySelector('[data-occubuy-score-value]')).not.toBeNull();
    });

    container.querySelector<HTMLButtonElement>("[data-occubuy-decline]")!.click();

    await vi.waitFor(() => {
      expect(onDecline).toHaveBeenCalledWith({ status: "declined" });
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("shows 'how to improve' copy that's specific to the band the customer landed in", async () => {
    const cases: Array<{ scoreId: string; score: number }> = [
      { scoreId: "score_low", score: 100 },
      { scoreId: "score_mid", score: 550 },
      { scoreId: "score_high", score: 900 },
    ];
    const improveTextByBand: string[] = [];

    for (const { scoreId, score } of cases) {
      const container = makeContainer();
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/scores")) {
          return Promise.resolve(
            jsonResponse({ scoreId, sessionToken: "test-session-token", fastlinkSession: FASTLINK_SESSION })
          );
        }
        if (url.endsWith(`/api/scores/${scoreId}/complete`)) {
          return Promise.resolve(jsonResponse({ status: "PROCESSING" }));
        }
        if (url.endsWith(`/api/scores/${scoreId}`)) {
          return Promise.resolve(jsonResponse({ status: "COMPLETED", score: { value: score } }));
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      });
      vi.stubGlobal("fetch", fetchMock);

      const instance = init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget", applicant: VALID_APPLICANT });
      instance.start();

      container.querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!.checked = true;
      container
        .querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!
        .dispatchEvent(new Event("change"));
      container.querySelector<HTMLButtonElement>("[data-occubuy-consent-submit]")!.click();

      await vi.waitFor(() => {
        expect(container.querySelector('[data-occubuy-step="bankConnection"]')).not.toBeNull();
      });

      const iframe = container.querySelector<HTMLIFrameElement>("[data-occubuy-fastlink-iframe]")!;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: fastLinkSuccessMessage({
            providerId: 16442,
            providerAccountId: 44556677,
            requestId: `req_${scoreId}`,
            providerName: "ANZ",
            status: "SUCCESS",
          }),
          origin: "http://localhost:8787",
          source: iframe.contentWindow,
        })
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "POST_MESSAGE", data: { action: "exit", sites: [] } },
          origin: "http://localhost:8787",
          source: iframe.contentWindow,
        })
      );

      await vi.waitFor(() => {
        expect(container.querySelector("[data-occubuy-improve-text]")?.textContent).toBeTruthy();
      });

      improveTextByBand.push(container.querySelector("[data-occubuy-improve-text]")!.textContent!);
      document.body.innerHTML = "";
      vi.unstubAllGlobals();
    }

    expect(new Set(improveTextByBand).size).toBe(3);
  });

  it("fires onError with a typed code when starting verification fails", async () => {
    const container = makeContainer();
    const fetchMock = vi.fn(() => Promise.reject(new Error("network down")));
    vi.stubGlobal("fetch", fetchMock);

    const onError = vi.fn();
    const instance = init({
      apiKey: "pk_sandbox_test",
      container: "#occubuy-widget",
      applicant: VALID_APPLICANT,
      onError,
    });
    instance.start();

    container.querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!.checked = true;
    container
      .querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!
      .dispatchEvent(new Event("change"));
    container.querySelector<HTMLButtonElement>("[data-occubuy-consent-submit]")!.click();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "START_FAILED" })
      );
      expect(container.querySelector('[data-occubuy-step="error"]')).not.toBeNull();
    });
  });

  it("fires onError with INVALID_APPLICANT and never calls the API when applicant details are bad", async () => {
    const container = makeContainer();
    const fetchMock = vi.fn(() => Promise.reject(new Error("should not be called")));
    vi.stubGlobal("fetch", fetchMock);

    const onError = vi.fn();
    const instance = init({
      apiKey: "pk_sandbox_test",
      container: "#occubuy-widget",
      applicant: { ...VALID_APPLICANT, phone: "not-a-phone-number" },
      onError,
    });
    instance.start();

    container.querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!.checked = true;
    container
      .querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!
      .dispatchEvent(new Event("change"));
    container.querySelector<HTMLButtonElement>("[data-occubuy-consent-submit]")!.click();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_APPLICANT" }));
    // the only call allowed is the colour lookup on start(), which carries no applicant data
    const urls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(urls.filter((url) => !url.endsWith("/partners/config"))).toEqual([]);
  });

  describe("colours set in the partner portal", () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    function stubConfig(response: Promise<Response>) {
      const fetchMock = vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith("/partners/config") ? response : Promise.reject(new Error(`Unexpected fetch: ${String(input)}`))
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    it("applies them once they arrive, without holding up the first screen", async () => {
      const container = makeContainer();
      const fetchMock = stubConfig(Promise.resolve(jsonResponse({ branding: { primaryColor: "#ff6b3d", headingColor: "#35205e" } })));

      init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget", applicant: VALID_APPLICANT }).start();
      // consent screen is already there before the colours come back
      expect(container.querySelector("[data-occubuy-consent-checkbox]")).not.toBeNull();
      expect(container.style.getPropertyValue("--occubuy-accent")).toBe("");

      await flush();
      expect(container.style.getPropertyValue("--occubuy-accent")).toBe("#ff6b3d");
      expect(container.style.getPropertyValue("--occubuy-heading")).toBe("#35205e");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8787/partners/config",
        expect.objectContaining({ headers: { Authorization: "Bearer pk_sandbox_test" } })
      );
    });

    it("colours passed to init() win over the portal's", async () => {
      const container = makeContainer();
      stubConfig(Promise.resolve(jsonResponse({ branding: { primaryColor: "#ff6b3d", headingColor: "#35205e" } })));

      init({
        apiKey: "pk_sandbox_test",
        container: "#occubuy-widget",
        applicant: VALID_APPLICANT,
        branding: { primaryColor: "#000000" },
      }).start();
      await flush();

      expect(container.style.getPropertyValue("--occubuy-accent")).toBe("#000000");
      expect(container.style.getPropertyValue("--occubuy-heading")).toBe("#35205e");
    });

    it("ignores anything that isn't a hex colour", async () => {
      const container = makeContainer();
      stubConfig(Promise.resolve(jsonResponse({ branding: { primaryColor: "red; background:url(x)", headingColor: "#35205e" } })));

      init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget", applicant: VALID_APPLICANT }).start();
      await flush();

      expect(container.style.getPropertyValue("--occubuy-accent")).toBe("");
      expect(container.style.getPropertyValue("--occubuy-heading")).toBe("#35205e");
    });

    it("a failed or refused lookup keeps the default colours and nothing breaks", async () => {
      for (const response of [Promise.reject(new Error("network down")), Promise.resolve(jsonResponse({ message: "no" }, false, 401))]) {
        document.body.innerHTML = "";
        const container = makeContainer();
        stubConfig(response);
        const onError = vi.fn();

        init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget", applicant: VALID_APPLICANT, onError }).start();
        await flush();

        expect(container.style.getPropertyValue("--occubuy-accent")).toBe("");
        expect(container.querySelector("[data-occubuy-consent-checkbox]")).not.toBeNull();
        expect(onError).not.toHaveBeenCalled();
      }
    });
  });

  it("ignores FastLink messages from an untrusted origin", async () => {
    const container = makeContainer();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ scoreId: "score_123", sessionToken: "test-session-token", fastlinkSession: FASTLINK_SESSION })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const instance = init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget", applicant: VALID_APPLICANT });
    instance.start();

    container.querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!.checked = true;
    container
      .querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]")!
      .dispatchEvent(new Event("change"));
    container.querySelector<HTMLButtonElement>("[data-occubuy-consent-submit]")!.click();

    await vi.waitFor(() => {
      expect(container.querySelector('[data-occubuy-step="bankConnection"]')).not.toBeNull();
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: fastLinkSuccessMessage({ providerId: 1, providerAccountId: 2, requestId: "evil", providerName: "Evil Bank", status: "SUCCESS" }),
        origin: "https://evil.example",
        source: null,
      })
    );

    // should still be stuck on the bank connection step since that message should just get ignored
    expect(container.querySelector('[data-occubuy-step="bankConnection"]')).not.toBeNull();
  });
});
