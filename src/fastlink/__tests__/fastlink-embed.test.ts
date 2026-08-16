// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountFastLink } from "../fastlink-embed.js";
import type { FastLinkSession } from "../models.js";

const session: FastLinkSession = {
  fastlinkUrl: "https://fastlink.example.test/authenticate/anz/fastlink",
  accessToken: "abc123",
  configName: "Verification"
};

const FASTLINK_ORIGIN = "https://fastlink.example.test";

const successData = {
  sites: [
    {
      providerId: 16441,
      providerName: "Dag Site",
      requestId: "req-1",
      status: "SUCCESS",
      additionalStatus: "ACCT_SUMMARY_RECEIVED",
      providerAccountId: 11107612
    }
  ]
};

/** Dispatches a message as if it came from the FastLink frame. */
function post(payload: unknown, origin = FASTLINK_ORIGIN) {
  window.dispatchEvent(
    new MessageEvent("message", { data: JSON.stringify(payload), origin })
  );
}

function container(): HTMLElement {
  const el = document.createElement("div");
  el.id = "fastlink-container";
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mountFastLink", () => {
  it("renders an iframe into the container", () => {
    const el = container();
    const handle = mountFastLink(el, { session, returnUrl: "occubuy://fastlinkfinish" });

    const iframe = el.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.srcdoc).toContain('action="https://fastlink.example.test/authenticate/anz/fastlink"');

    handle.destroy();
  });

  it("resolves the container by selector string", () => {
    container();
    const handle = mountFastLink("fastlink-container", { session });
    expect(document.querySelector("#fastlink-container iframe")).not.toBeNull();
    handle.destroy();
  });

  it("throws when the container does not exist", () => {
    expect(() => mountFastLink("#nope", { session })).toThrow(/container not found/);
  });

  // Any page can postMessage into the parent window, so origin is the only guard.
  it("ignores messages from a foreign origin", async () => {
    const el = container();
    const onEvent = vi.fn();
    const handle = mountFastLink(el, { session, onEvent });

    post(successData, "https://evil.example");
    post({ type: "POST_MESSAGE", data: { action: "exit" } }, "https://evil.example");

    expect(onEvent).not.toHaveBeenCalled();

    let settled = false;
    void handle.result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    handle.destroy();
  });

  it("accepts messages from the FastLink origin", async () => {
    const el = container();
    const handle = mountFastLink(el, { session });

    post({ type: "POST_MESSAGE", data: { ...successData, action: "exit" } });

    const outcome = await handle.result;
    expect(outcome.cancelled).toBe(false);
    expect(outcome.payload?.providerAccountId).toBe(11107612);

    handle.destroy();
  });

  it("resolves cancelled when the user exits without linking", async () => {
    const el = container();
    const handle = mountFastLink(el, { session });

    post({ type: "POST_MESSAGE", data: { action: "exit", sites: [] } });

    const outcome = await handle.result;
    expect(outcome.cancelled).toBe(true);
    expect(outcome.payload).toBeUndefined();

    handle.destroy();
  });

  // The production ordering bug, exercised through the real listener.
  it("resolves success when exit arrives before the success payload", async () => {
    const el = container();
    const handle = mountFastLink(el, { session });

    post({ type: "POST_MESSAGE", data: { action: "exit", ...successData } });
    post({ type: "POST_MESSAGE", data: successData });

    const outcome = await handle.result;
    expect(outcome.cancelled).toBe(false);
    expect(outcome.payload?.requestId).toBe("req-1");

    handle.destroy();
  });

  it("destroy removes the listener and the iframe", () => {
    const el = container();
    const onEvent = vi.fn();
    const handle = mountFastLink(el, { session, onEvent });

    handle.destroy();
    post({ type: "POST_MESSAGE", data: { action: "exit" } });

    expect(onEvent).not.toHaveBeenCalled();
    expect(el.querySelector("iframe")).toBeNull();
  });

  it("destroy is idempotent", () => {
    const el = container();
    const handle = mountFastLink(el, { session });
    handle.destroy();
    expect(() => handle.destroy()).not.toThrow();
  });

  it("rejects the unimplemented yodleeJs transport", () => {
    container();
    expect(() =>
      mountFastLink("fastlink-container", { session, transport: "yodleeJs" })
    ).toThrow(/not implemented/);
  });
});
