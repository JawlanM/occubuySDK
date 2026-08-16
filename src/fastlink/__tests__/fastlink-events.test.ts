import { describe, expect, it } from "vitest";
import {
  FastLinkFlowState,
  hasSuccessSite,
  latestSuccessSite,
  parseFastLinkMessage
} from "../fastlink-events.js";

/**
 * These cases are the cross-platform contract for FastLink event handling.
 * The Swift, Kotlin and Dart suites mirror them by name.
 */

const site = (overrides: Record<string, unknown> = {}) => ({
  providerId: 16441,
  providerName: "Dag Site",
  requestId: "pSuUfXjxE+GOu0FuWKmw46laCPM=",
  status: "SUCCESS",
  additionalStatus: "ACCT_SUMMARY_RECEIVED",
  providerAccountId: 11107612,
  fnToCall: "accountStatus",
  ...overrides
});

describe("parseFastLinkMessage", () => {
  it("extracts the url from OPEN_EXTERNAL_URL", () => {
    const event = parseFastLinkMessage(
      JSON.stringify({ type: "OPEN_EXTERNAL_URL", data: { url: "https://bank.example/authorize" } })
    );
    expect(event.type).toBe("OPEN_EXTERNAL_URL");
    expect(event.url).toBe("https://bank.example/authorize");
  });

  it("extracts the url from BANK_OAUTH_URL", () => {
    const event = parseFastLinkMessage(
      JSON.stringify({ type: "BANK_OAUTH_URL", data: { url: "https://oauth.bank.example/start" } })
    );
    expect(event.type).toBe("BANK_OAUTH_URL");
    expect(event.url).toBe("https://oauth.bank.example/start");
  });

  it("exposes the action for POST_MESSAGE", () => {
    const event = parseFastLinkMessage(
      JSON.stringify({ type: "POST_MESSAGE", data: { action: "exit", sites: [] } })
    );
    expect(event.type).toBe("POST_MESSAGE");
    expect(event.action).toBe("exit");
  });

  it("returns UNKNOWN for malformed JSON without throwing", () => {
    const event = parseFastLinkMessage("{not json");
    expect(event.type).toBe("UNKNOWN");
    expect(event.data).toEqual({});
    expect(event.raw).toBe("{not json");
  });

  it("returns UNKNOWN for an unrecognised type but keeps data", () => {
    const event = parseFastLinkMessage(
      JSON.stringify({ type: "SOMETHING_NEW", data: { sites: [site()] } })
    );
    expect(event.type).toBe("UNKNOWN");
    // Success can ride on any message type, so data must survive.
    expect(latestSuccessSite(event.data)).not.toBeNull();
  });

  it("accepts an already-parsed object", () => {
    const event = parseFastLinkMessage({ type: "POST_MESSAGE", data: { action: "exit" } });
    expect(event.type).toBe("POST_MESSAGE");
    expect(event.action).toBe("exit");
  });

  it("tolerates a message with no data object", () => {
    const event = parseFastLinkMessage(JSON.stringify({ type: "POST_MESSAGE" }));
    expect(event.data).toEqual({});
    expect(event.action).toBeUndefined();
  });
});

describe("latestSuccessSite", () => {
  it("picks the last SUCCESS site so a newly linked account wins", () => {
    const payload = latestSuccessSite({
      sites: [
        site({ status: "FAILED", providerAccountId: 1 }),
        site({ providerAccountId: 2 }),
        site({ providerAccountId: 3 })
      ]
    });
    expect(payload?.providerAccountId).toBe(3);
  });

  it("skips trailing non-SUCCESS sites", () => {
    const payload = latestSuccessSite({
      sites: [site({ providerAccountId: 7 }), site({ status: "FAILED", providerAccountId: 8 })]
    });
    expect(payload?.providerAccountId).toBe(7);
  });

  it("skips a SUCCESS site with no correlating identifiers", () => {
    const payload = latestSuccessSite({
      sites: [
        site({ providerAccountId: 42 }),
        { status: "SUCCESS", providerId: null, providerAccountId: null, requestId: null }
      ]
    });
    expect(payload?.providerAccountId).toBe(42);
  });

  it("falls back to the data object when there is no sites array", () => {
    const payload = latestSuccessSite(site());
    expect(payload?.providerAccountId).toBe(11107612);
    expect(payload?.providerName).toBe("Dag Site");
  });

  it("inherits additionalStatus and fnToCall from the envelope", () => {
    const payload = latestSuccessSite({
      additionalStatus: "ACCT_SUMMARY_RECEIVED",
      fnToCall: "accountStatus",
      sites: [{ status: "SUCCESS", providerAccountId: 5 }]
    });
    expect(payload?.additionalStatus).toBe("ACCT_SUMMARY_RECEIVED");
    expect(payload?.fnToCall).toBe("accountStatus");
  });

  it("prefers the site's own additionalStatus over the envelope's", () => {
    const payload = latestSuccessSite({
      additionalStatus: "ENVELOPE",
      sites: [site({ additionalStatus: "SITE" })]
    });
    expect(payload?.additionalStatus).toBe("SITE");
  });

  it("coerces string ids to numbers", () => {
    const payload = latestSuccessSite({
      sites: [site({ providerId: "16441", providerAccountId: "11107612" })]
    });
    expect(payload?.providerId).toBe(16441);
    expect(payload?.providerAccountId).toBe(11107612);
  });

  it("returns null when nothing succeeded", () => {
    expect(latestSuccessSite({ sites: [site({ status: "FAILED" })] })).toBeNull();
    expect(latestSuccessSite({ status: "FAILED" })).toBeNull();
    expect(latestSuccessSite(null)).toBeNull();
    expect(latestSuccessSite({})).toBeNull();
  });

  it("keeps a site identified only by requestId", () => {
    const payload = latestSuccessSite({
      sites: [{ status: "SUCCESS", requestId: "abc" }]
    });
    expect(payload?.requestId).toBe("abc");
    expect(payload?.providerAccountId).toBeUndefined();
  });
});

describe("hasSuccessSite", () => {
  it("is true when any site succeeded, regardless of position", () => {
    expect(hasSuccessSite({ sites: [site({ status: "FAILED" }), site()] })).toBe(true);
  });

  it("is false for an empty or all-failed sites array", () => {
    expect(hasSuccessSite({ sites: [] })).toBe(false);
    expect(hasSuccessSite({ sites: [site({ status: "FAILED" })] })).toBe(false);
  });

  it("falls back to the top-level status", () => {
    expect(hasSuccessSite({ status: "SUCCESS" })).toBe(true);
    expect(hasSuccessSite(null)).toBe(false);
  });
});

describe("FastLinkFlowState", () => {
  it("success then exit submits once and finishes once", () => {
    const state = new FastLinkFlowState();

    const onSuccess = state.onSuccess();
    expect(onSuccess).toEqual({ submit: true, finish: false, cancel: false });

    const onExit = state.onExit(true);
    expect(onExit).toEqual({ submit: false, finish: true, cancel: false });
    expect(state.isTerminated).toBe(true);
  });

  // The production bug: FastLink emits these two in non-deterministic order.
  it("exit before success still submits once and finishes once", () => {
    const state = new FastLinkFlowState();

    const onExit = state.onExit(true);
    expect(onExit).toEqual({ submit: false, finish: false, cancel: false });
    expect(state.isTerminated).toBe(false);

    const onSuccess = state.onSuccess();
    expect(onSuccess).toEqual({ submit: true, finish: true, cancel: false });
    expect(state.isTerminated).toBe(true);
  });

  it("exit with no linked site cancels and never submits", () => {
    const state = new FastLinkFlowState();

    expect(state.onExit(false)).toEqual({ submit: false, finish: false, cancel: true });
    expect(state.isTerminated).toBe(true);
    expect(state.onSuccess()).toEqual({ submit: true, finish: false, cancel: false });
  });

  it("a repeated success payload is idempotent", () => {
    const state = new FastLinkFlowState();

    expect(state.onSuccess().submit).toBe(true);
    expect(state.onSuccess()).toEqual({ submit: false, finish: false, cancel: false });
    expect(state.onSuccess()).toEqual({ submit: false, finish: false, cancel: false });
  });

  it("a repeated exit produces a single cancel", () => {
    const state = new FastLinkFlowState();

    expect(state.onExit(false).cancel).toBe(true);
    expect(state.onExit(false)).toEqual({ submit: false, finish: false, cancel: false });
  });

  it("a repeated exit after success produces a single finish", () => {
    const state = new FastLinkFlowState();
    state.onSuccess();

    expect(state.onExit(true).finish).toBe(true);
    expect(state.onExit(true)).toEqual({ submit: false, finish: false, cancel: false });
  });

  it("does not cancel after the flow already succeeded", () => {
    const state = new FastLinkFlowState();
    state.onSuccess();
    state.onExit(true);

    // A late stray exit must not turn a completed verification into a cancellation.
    expect(state.onExit(false)).toEqual({ submit: false, finish: false, cancel: false });
  });
});
