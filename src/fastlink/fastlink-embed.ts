import {
  FastLinkFlowState,
  hasSuccessSite,
  latestSuccessSite,
  parseFastLinkMessage,
  type FastLinkEvent
} from "./fastlink-events.js";
import { buildFastLinkForm } from "./fastlink-form.js";
import type { FastLinkSession, FastLinkSuccessPayload } from "./models.js";

/**
 * Renders Yodlee FastLink 4 into a host-supplied container.
 *
 * On mobile, FastLink events arrive over the `YWebViewHandler` JavaScript channel.
 * On web there is no such channel — the FastLink frame `postMessage`s to its parent,
 * so this module listens on `window` and filters by origin.
 */

/**
 * How FastLink events reach the page.
 *
 * `postMessage` is the default. `yodleeJs` is reserved for tenants that require
 * `cdn.yodlee.com/fastlink/v4/initialize.js`; it is not implemented yet, and which
 * one this tenant needs is still unverified.
 */
export type FastLinkTransport = "postMessage" | "yodleeJs";

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

export function mountFastLink(
  target: HTMLElement | string,
  options: MountFastLinkOptions
): FastLinkHandle {
  const { session, mode = "iframe", transport = "postMessage", onEvent } = options;

  if (transport === "yodleeJs") {
    throw new Error(
      "The yodleeJs transport is not implemented. Use the default postMessage transport."
    );
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
