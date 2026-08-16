import type { FastLinkSuccessPayload } from "./models.js";

/**
 * Canonical Yodlee FastLink 4 event handling.
 *
 * This file is the reference implementation; the Swift, Kotlin and Dart ports
 * mirror its behaviour and test names one-for-one. Behaviour is derived from the
 * production Flutter integration in the Occubuy app
 * (`lib/view/screens/fast_link_view/fast_link_view_screen.dart`).
 *
 * On mobile these events arrive over the `YWebViewHandler` JavaScript channel.
 * On web they arrive as `postMessage` events from the FastLink frame.
 */

export type FastLinkEventType =
  | "POST_MESSAGE"
  | "OPEN_EXTERNAL_URL"
  | "BANK_OAUTH_URL"
  | "UNKNOWN";

export interface FastLinkEvent {
  type: FastLinkEventType;
  /**
   * The message's `data` object, always present (empty when the message had none).
   *
   * Success can ride along on any message type, not just `POST_MESSAGE`, so callers
   * run {@link latestSuccessSite} against `data` for *every* event rather than
   * switching on `type` first.
   */
  data: Record<string, unknown>;
  /** `data.action` for `POST_MESSAGE` — `"exit"` is the one that matters. */
  action?: string;
  /** `data.url` for `OPEN_EXTERNAL_URL` / `BANK_OAUTH_URL`. */
  url?: string;
  /** The original message, retained for logging when `type` is `UNKNOWN`. */
  raw: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Coerces Yodlee's loosely-typed numeric ids.
 *
 * `providerId` and `providerAccountId` arrive as either a JSON number or a string
 * depending on the event, so both are accepted and anything else becomes undefined.
 */
export function asInt(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/**
 * Parses one raw `YWebViewHandler` / `postMessage` payload.
 *
 * Never throws — malformed input becomes an `UNKNOWN` event so a single bad
 * message cannot tear down a live FastLink session.
 */
export function parseFastLinkMessage(raw: string | object): FastLinkEvent {
  const rawText = typeof raw === "string" ? raw : safeStringify(raw);

  let parsed: unknown;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { type: "UNKNOWN", data: {}, raw: rawText };
    }
  } else {
    parsed = raw;
  }

  const envelope = asRecord(parsed);
  const data = asRecord(envelope.data);
  const type = asString(envelope.type);

  switch (type) {
    case "POST_MESSAGE":
      return {
        type: "POST_MESSAGE",
        data,
        action: asString(data.action),
        raw: rawText
      };
    case "OPEN_EXTERNAL_URL":
    case "BANK_OAUTH_URL":
      return { type, data, url: asString(data.url), raw: rawText };
    default:
      return { type: "UNKNOWN", data, raw: rawText };
  }
}

function safeStringify(value: object): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Extracts the most recently linked institution from a FastLink `data` object.
 *
 * Iterates `data.sites` **backwards** so that when a user links a second account in
 * the same session the newest one wins — otherwise a previously-linked account is
 * reported again and the backend pulls stale data.
 *
 * Sites without any of `providerId` / `providerAccountId` / `requestId` are skipped:
 * FastLink emits placeholder entries that carry a `SUCCESS` status but nothing to
 * correlate against.
 *
 * Falls back to the `data` object itself when there is no `sites` array but the
 * top-level status is `SUCCESS`.
 */
export function latestSuccessSite(
  data: Record<string, unknown> | null | undefined
): FastLinkSuccessPayload | null {
  if (!data) return null;

  const sites = data.sites;
  if (Array.isArray(sites)) {
    for (let i = sites.length - 1; i >= 0; i--) {
      const site = asRecord(sites[i]);
      if (asString(site.status) !== "SUCCESS") continue;

      const providerId = asInt(site.providerId);
      const providerAccountId = asInt(site.providerAccountId);
      const requestId = asString(site.requestId);

      if (providerId === undefined && providerAccountId === undefined && requestId === undefined) {
        continue;
      }

      return {
        providerId,
        providerName: asString(site.providerName),
        requestId,
        status: asString(site.status),
        // additionalStatus and fnToCall are sometimes only present on the envelope.
        additionalStatus: asString(site.additionalStatus) ?? asString(data.additionalStatus),
        providerAccountId,
        fnToCall: asString(site.fnToCall) ?? asString(data.fnToCall)
      };
    }
  }

  if (asString(data.status) === "SUCCESS") {
    return {
      providerId: asInt(data.providerId),
      providerName: asString(data.providerName),
      requestId: asString(data.requestId),
      status: "SUCCESS",
      additionalStatus: asString(data.additionalStatus),
      providerAccountId: asInt(data.providerAccountId),
      fnToCall: asString(data.fnToCall)
    };
  }

  return null;
}

/** Whether a FastLink `data` object contains at least one successfully linked site. */
export function hasSuccessSite(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  const sites = data.sites;
  if (Array.isArray(sites)) {
    return sites.some((site) => asString(asRecord(site).status) === "SUCCESS");
  }
  return asString(data.status) === "SUCCESS";
}

/**
 * What the host should do in response to a FastLink event.
 *
 * More than one flag can be set at once: when the exit message arrives before the
 * success payload, the success that follows both submits and finishes the flow.
 */
export interface FastLinkDecision {
  /** Report the linked account to the backend. */
  submit: boolean;
  /** Move to the terminal success screen. */
  finish: boolean;
  /** The user closed FastLink without linking anything. */
  cancel: boolean;
}

const NOTHING: FastLinkDecision = { submit: false, finish: false, cancel: false };

/**
 * Ordering guard for FastLink's terminal events.
 *
 * FastLink 4 emits the success payload and `POST_MESSAGE action=exit` in
 * **non-deterministic order**. Handling either one in isolation produces a flow that
 * intermittently either double-submits or hangs on the web view after the user has
 * already linked their bank. This state machine is a direct extraction of the fix
 * that ships in the Occubuy app (`_hasHandledSuccess` / `_pendingExitAfterSuccess` /
 * `_navigated`, `fast_link_view_screen.dart:49-53`).
 */
export class FastLinkFlowState {
  private handledSuccess = false;
  private pendingExitAfterSuccess = false;
  private terminated = false;

  /** A success payload arrived. Submits once; finishes too if exit already landed. */
  onSuccess(): FastLinkDecision {
    if (this.handledSuccess) return NOTHING;
    this.handledSuccess = true;

    if (this.pendingExitAfterSuccess && !this.terminated) {
      this.terminated = true;
      return { submit: true, finish: true, cancel: false };
    }
    return { submit: true, finish: false, cancel: false };
  }

  /**
   * `POST_MESSAGE action=exit` arrived.
   *
   * @param withSuccessSite whether the same message reported a linked site — if it
   *   did not, the user closed FastLink without linking and the flow is cancelled.
   */
  onExit(withSuccessSite: boolean): FastLinkDecision {
    if (this.terminated) return NOTHING;

    if (!withSuccessSite) {
      this.terminated = true;
      return { submit: false, finish: false, cancel: true };
    }

    if (this.handledSuccess) {
      this.terminated = true;
      return { submit: false, finish: true, cancel: false };
    }

    // Success has not arrived yet; finish when it does.
    this.pendingExitAfterSuccess = true;
    return NOTHING;
  }

  /** True once the flow has reached a terminal state, successful or cancelled. */
  get isTerminated(): boolean {
    return this.terminated;
  }
}
