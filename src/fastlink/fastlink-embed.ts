import {
  FastLinkFlowState,
  hasSuccessSite,
  latestSuccessSite,
  parseFastLinkMessage,
  type FastLinkEvent
} from "./fastlink-events.js";
import { buildFastLinkForm } from "./fastlink-form.js";
import type { FastLinkSession, FastLinkSuccessPayload, FastLinkTransport } from "./models.js";

export type { FastLinkTransport } from "./models.js";

/**
 * Renders Yodlee FastLink 4 into a host-supplied container.
 *
 * On mobile, FastLink events arrive over the `YWebViewHandler` JavaScript channel.
 * On web there is no such channel — the FastLink frame `postMessage`s to its parent,
 * so this module listens on `window` and filters by origin.
 */

const YODLEE_INITIALIZE_JS_URL = "https://cdn.yodlee.com/fastlink/v4/initialize.js";

interface YodleeFastlinkGlobal {
  open: (
    options: {
      fastLinkURL: string;
      accessToken: string;
      forceIframe?: boolean;
      params?: Record<string, unknown>;
      onSuccess?: (data: Record<string, unknown>) => void;
      onError?: (data: Record<string, unknown>) => void;
      onClose?: (data: Record<string, unknown>) => void;
      onEvent?: (data: Record<string, unknown>) => void;
    },
    containerId: string
  ) => void;
  close: () => void;
}

declare global {
  interface Window {
    fastlink?: YodleeFastlinkGlobal;
  }
}

let yodleeJsLoad: Promise<YodleeFastlinkGlobal> | undefined;

/**
 * Loads `cdn.yodlee.com/fastlink/v4/initialize.js` once and resolves `window.fastlink`.
 *
 * Cached across calls in the same page — Yodlee's own script defines a single global,
 * loading it twice is wasted work, not a correctness issue, but there is no reason to.
 */
export function loadYodleeInitializeJs(): Promise<YodleeFastlinkGlobal> {
  if (window.fastlink) return Promise.resolve(window.fastlink);
  if (yodleeJsLoad) return yodleeJsLoad;

  yodleeJsLoad = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = YODLEE_INITIALIZE_JS_URL;
    script.async = true;
    script.onload = () => {
      if (window.fastlink) resolve(window.fastlink);
      else reject(new Error("initialize.js loaded but did not define window.fastlink"));
    };
    script.onerror = () => reject(new Error(`Failed to load ${YODLEE_INITIALIZE_JS_URL}`));
    document.head.appendChild(script);
  });
  return yodleeJsLoad;
}

let containerIdSeq = 0;

/** Yodlee's `open()` takes a container element id, not a reference — this assigns one if missing. */
function ensureElementId(element: HTMLElement): string {
  if (element.id) return element.id;
  containerIdSeq += 1;
  element.id = `occubuy-fastlink-container-${containerIdSeq}`;
  return element.id;
}

export interface MountFastLinkOptions {
  session: FastLinkSession;
  /** `intentUrl` for the OAuth return. Defaults to the current page URL. */
  returnUrl?: string;
  /**
   * `iframe` embeds FastLink in the container. `popup` opens a separate window, for
   * tenants whose `X-Frame-Options` / `frame-ancestors` forbid framing.
   */
  mode?: "iframe" | "popup";
  transport?: FastLinkTransport;
  /** Observes every parsed event, including ones the SDK does not act on. */
  onEvent?: (event: FastLinkEvent) => void;
}

export interface FastLinkOutcome {
  cancelled: boolean;
  payload?: FastLinkSuccessPayload;
}

export interface FastLinkHandle {
  /** Resolves once FastLink reports success or the user closes it. */
  result: Promise<FastLinkOutcome>;
  /** Removes the listener and tears down the iframe or popup. Safe to call twice. */
  destroy(): void;
}

function resolveTarget(target: HTMLElement | string): HTMLElement {
  if (typeof target !== "string") return target;
  const element = document.getElementById(target) ?? document.querySelector(target);
  if (!element) {
    throw new Error(`FastLink container not found: ${target}`);
  }
  return element as HTMLElement;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * `yodleeJs` transport: loads `initialize.js` and calls `window.fastlink.open()`
 * instead of POSTing a hand-built form. Required for tenants whose edge security
 * rejects a raw form POST (see the `FastLinkTransport` doc comment in `models.ts`
 * for the concrete incident this was verified against).
 */
function mountFastLinkViaYodleeJs(
  target: HTMLElement | string,
  options: MountFastLinkOptions
): FastLinkHandle {
  const { session, onEvent } = options;
  const container = resolveTarget(target);
  const containerId = ensureElementId(container);
  const state = new FastLinkFlowState();

  let destroyed = false;
  let settle: (outcome: FastLinkOutcome) => void = () => {};
  let pendingPayload: FastLinkSuccessPayload | undefined;

  const result = new Promise<FastLinkOutcome>((resolve) => {
    settle = resolve;
  });

  function handleData(raw: Record<string, unknown>, isExit: boolean): void {
    if (destroyed) return;
    const event: FastLinkEvent = { type: isExit ? "POST_MESSAGE" : "UNKNOWN", data: raw, raw: "" };
    if (isExit) event.action = "exit";
    onEvent?.(event);

    const success = latestSuccessSite(raw);
    if (success) {
      pendingPayload = success;
      if (state.onSuccess().finish) settle({ cancelled: false, payload: pendingPayload });
    }

    if (isExit) {
      const decision = state.onExit(hasSuccessSite(raw) || pendingPayload !== undefined);
      if (decision.finish) settle({ cancelled: false, payload: pendingPayload });
      else if (decision.cancel) settle({ cancelled: true });
    }
  }

  loadYodleeInitializeJs()
    .then((fastlink) => {
      if (destroyed) return;
      fastlink.open(
        {
          fastLinkURL: session.fastlinkUrl,
          accessToken: session.accessToken,
          forceIframe: true,
          params: {
            ...(session.configName ? { configName: session.configName } : {}),
            ...session.extraParams
          },
          onSuccess: (data) => handleData(data, false),
          onError: (data) => handleData({ ...data, status: data.status ?? "FAILED" }, true),
          onClose: (data) => handleData(data, true),
          onEvent: (data) => handleData(data, false)
        },
        containerId
      );
    })
    .catch(() => {
      if (!destroyed) settle({ cancelled: true });
    });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    window.fastlink?.close();
  };

  return { result, destroy };
}

export function mountFastLink(
  target: HTMLElement | string,
  options: MountFastLinkOptions
): FastLinkHandle {
  const { session, mode = "iframe", transport = "postMessage", onEvent } = options;

  if (transport === "yodleeJs") {
    return mountFastLinkViaYodleeJs(target, options);
  }

  const returnUrl = options.returnUrl ?? window.location.href;
  const html = buildFastLinkForm(session, returnUrl);
  const expectedOrigin = originOf(session.fastlinkUrl);

  const container = mode === "iframe" ? resolveTarget(target) : null;
  const state = new FastLinkFlowState();

  let iframe: HTMLIFrameElement | null = null;
  let popup: Window | null = null;
  let destroyed = false;
  let settle: (outcome: FastLinkOutcome) => void = () => {};
  let pendingPayload: FastLinkSuccessPayload | undefined;

  const result = new Promise<FastLinkOutcome>((resolve) => {
    settle = resolve;
  });

  const onMessage = (event: MessageEvent) => {
    // Any page can postMessage into this window; only the FastLink origin is trusted.
    if (expectedOrigin !== null && event.origin !== expectedOrigin) return;

    const parsed = parseFastLinkMessage(
      typeof event.data === "string" ? event.data : (event.data as object)
    );
    onEvent?.(parsed);

    // Success can arrive on any message type, so check every event.
    const success = latestSuccessSite(parsed.data);
    if (success) {
      pendingPayload = success;
      const decision = state.onSuccess();
      if (decision.finish) {
        settle({ cancelled: false, payload: pendingPayload });
      }
    }

    if (parsed.type === "POST_MESSAGE" && parsed.action === "exit") {
      const decision = state.onExit(hasSuccessSite(parsed.data) || pendingPayload !== undefined);
      if (decision.finish) {
        settle({ cancelled: false, payload: pendingPayload });
      } else if (decision.cancel) {
        settle({ cancelled: true });
      }
    }
  };

  window.addEventListener("message", onMessage);

  if (mode === "iframe") {
    iframe = document.createElement("iframe");
    iframe.title = "Connect your bank";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.setAttribute("allow", "clipboard-write");
    container!.appendChild(iframe);
    iframe.srcdoc = html;
  } else {
    popup = window.open("", "occubuy-fastlink", "width=480,height=720");
    if (!popup) {
      window.removeEventListener("message", onMessage);
      throw new Error("FastLink popup was blocked by the browser");
    }
    popup.document.write(html);
    popup.document.close();
  }

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("message", onMessage);
    iframe?.remove();
    if (popup && !popup.closed) popup.close();
  };

  return { result, destroy };
}
