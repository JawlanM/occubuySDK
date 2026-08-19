import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "../src/index";

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

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OccubuyScore.init", () => {
  it("throws without an apiKey", () => {
    // @ts-expect-error leaving out apiKey on purpose for this test
    expect(() => init({ container: makeContainer() })).toThrow();
  });

  it("throws without a container", () => {
    // @ts-expect-error leaving out container on purpose for this test
    expect(() => init({ apiKey: "pk_sandbox_test" })).toThrow();
  });

  it("returns a start() function and renders the consent step into the container", () => {
    const container = makeContainer();
    const instance = init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget" });
    expect(typeof instance.start).toBe("function");

    instance.start();

    expect(container.querySelector('[data-occubuy-step="consent"]')).not.toBeNull();
    expect(container.querySelector("[data-occubuy-consent-checkbox]")).not.toBeNull();
    expect(container.querySelector("[data-occubuy-consent-submit]")).not.toBeNull();
    // the styles should only get added once, and everything should be occubuy- prefixed
    expect(document.getElementById("occubuy-style")).not.toBeNull();
  });

  it("drives consent -> bank connection -> score through to onComplete", async () => {
    const container = makeContainer();

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/scores")) {
        return Promise.resolve(jsonResponse({ scoreId: "score_123", fastlinkSession: "fake-session" }));
      }
      if (url.endsWith("/api/scores/score_123/complete")) {
        return Promise.resolve(jsonResponse({ status: "PROCESSING" }));
      }
      if (url.endsWith("/api/scores/score_123")) {
        return Promise.resolve(jsonResponse({ status: "COMPLETED", score: 822 }));
      }
      if (url.endsWith("/api/scores/score_123/share")) {
        return Promise.resolve(jsonResponse({ score: 822, band: "strong", verifiedAt: "2026-08-18T00:00:00.000Z" }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const onComplete = vi.fn();
    const instance = init({
      apiKey: "pk_sandbox_test",
      container: "#occubuy-widget",
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
        data: { type: "FastLink", event: "SUCCESS", data: { bank: "ANZ", accountId: "acc_1" } },
        origin: "http://localhost:8788",
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
        expect.objectContaining({ status: "success", score: 822, band: "strong", verifiedAt: "2026-08-18T00:00:00.000Z" })
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
        return Promise.resolve(jsonResponse({ scoreId: "score_789", fastlinkSession: "fake-session" }));
      }
      if (url.endsWith("/api/scores/score_789/complete")) {
        return Promise.resolve(jsonResponse({ status: "PROCESSING" }));
      }
      if (url.endsWith("/api/scores/score_789")) {
        return Promise.resolve(jsonResponse({ status: "COMPLETED", score: 500 }));
      }
      if (url.endsWith("/api/scores/score_789/share")) {
        return Promise.resolve(jsonResponse({ score: 500, band: "moderate", verifiedAt: "2026-08-18T00:00:00.000Z" }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const onComplete = vi.fn();
    const instance = init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget", onComplete });
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
        data: { type: "FastLink", event: "SUCCESS", data: { bank: "ANZ", accountId: "acc_3" } },
        origin: "http://localhost:8788",
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
        return Promise.resolve(jsonResponse({ scoreId: "score_456", fastlinkSession: "fake-session" }));
      }
      if (url.endsWith("/api/scores/score_456/complete")) {
        return Promise.resolve(jsonResponse({ status: "PROCESSING" }));
      }
      if (url.endsWith("/api/scores/score_456")) {
        return Promise.resolve(jsonResponse({ status: "COMPLETED", score: 259 }));
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
        data: { type: "FastLink", event: "SUCCESS", data: { bank: "ANZ", accountId: "acc_2" } },
        origin: "http://localhost:8788",
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
          return Promise.resolve(jsonResponse({ scoreId, fastlinkSession: "fake-session" }));
        }
        if (url.endsWith(`/api/scores/${scoreId}/complete`)) {
          return Promise.resolve(jsonResponse({ status: "PROCESSING" }));
        }
        if (url.endsWith(`/api/scores/${scoreId}`)) {
          return Promise.resolve(jsonResponse({ status: "COMPLETED", score }));
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      });
      vi.stubGlobal("fetch", fetchMock);

      const instance = init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget" });
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
          data: { type: "FastLink", event: "SUCCESS", data: { bank: "ANZ" } },
          origin: "http://localhost:8788",
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
    const instance = init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget", onError });
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

  it("ignores FastLink messages from an untrusted origin", async () => {
    const container = makeContainer();
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ scoreId: "score_123", fastlinkSession: "fake-session" }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const instance = init({ apiKey: "pk_sandbox_test", container: "#occubuy-widget" });
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
        data: { type: "FastLink", event: "SUCCESS", data: { bank: "Evil Bank" } },
        origin: "https://evil.example",
        source: null,
      })
    );

    // should still be stuck on the bank connection step since that message should just get ignored
    expect(container.querySelector('[data-occubuy-step="bankConnection"]')).not.toBeNull();
  });
});
