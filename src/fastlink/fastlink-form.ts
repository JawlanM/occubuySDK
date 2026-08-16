import type { FastLinkSession } from "./models.js";

/**
 * Builds the auto-submitting POST form that launches Yodlee FastLink 4.
 *
 * FastLink is not a URL you navigate to. It is a form POST target that expects
 * `accessToken` and `extraParams` as form fields, which is why the SDK hosts its
 * own web view rather than handing a URL to a browser tab.
 *
 * This file is the reference implementation; the Swift, Kotlin and Dart ports
 * mirror its behaviour and test names one-for-one.
 */

/** Reserved `extraParams` keys the SDK always controls. */
const RESERVED_EXTRA_PARAMS = new Set(["configName", "intentUrl"]);

/**
 * Escapes a value for use inside a double-quoted HTML attribute.
 *
 * The `&` case matters most: `extraParams` is a `&`-separated query string, and an
 * unescaped `&` inside an attribute is parsed as the start of a character
 * reference, silently truncating the parameters.
 */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Percent-encodes an `extraParams` value.
 *
 * `intentUrl` is exempt from encoding `:` and `/` — Yodlee matches the intent URL
 * literally, so `occubuy://fastlinkfinish` must survive as-is or the OAuth return
 * never fires.
 */
export function encodeExtraParamValue(value: string, preserveUrlDelimiters = false): string {
  const encoded = encodeURIComponent(value);
  return preserveUrlDelimiters ? encoded.replace(/%3A/gi, ":").replace(/%2F/gi, "/") : encoded;
}

/**
 * Assembles the `extraParams` field: `configName=…&intentUrl=…` plus any
 * backend-supplied extras. Extras may not override the two reserved keys.
 */
export function buildExtraParams(session: FastLinkSession, returnUrl: string): string {
  const parts: string[] = [];

  if (session.configName && session.configName.length > 0) {
    parts.push(`configName=${encodeExtraParamValue(session.configName)}`);
  }
  parts.push(`intentUrl=${encodeExtraParamValue(returnUrl, true)}`);

  // Sorted so the output is deterministic across platforms — Swift dictionaries have
  // no insertion order, so key order cannot be relied on to match the backend's.
  const extras = Object.entries(session.extraParams ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  for (const [key, value] of extras) {
    if (RESERVED_EXTRA_PARAMS.has(key)) continue;
    parts.push(`${encodeExtraParamValue(key)}=${encodeExtraParamValue(value)}`);
  }

  return parts.join("&");
}

/**
 * Applies exactly one `Bearer ` prefix, tolerating a backend that already added it.
 */
export function bearerToken(accessToken: string): string {
  const trimmed = accessToken.trim();
  return /^bearer\s/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

/**
 * Builds the complete HTML document that POSTs into FastLink on load.
 *
 * @param session the FastLink session from the backend
 * @param returnUrl the `intentUrl` FastLink redirects to after bank OAuth
 */
export function buildFastLinkForm(session: FastLinkSession, returnUrl: string): string {
  if (!session.fastlinkUrl || session.fastlinkUrl.length === 0) {
    throw new Error("FastLink session is missing a URL");
  }
  if (!session.accessToken || session.accessToken.length === 0) {
    throw new Error("FastLink session is missing an access token");
  }

  const action = escapeHtmlAttribute(session.fastlinkUrl);
  const token = escapeHtmlAttribute(bearerToken(session.accessToken));
  const extraParams = escapeHtmlAttribute(buildExtraParams(session, returnUrl));

  return `<!DOCTYPE html>
<html>
  <body>
    <form id="fastlink-form" name="fastlink-form" action="${action}" method="POST">
      <input name="accessToken" value="${token}" hidden="true" />
      <input name="extraParams" value="${extraParams}" hidden="true" />
    </form>
    <script type="text/javascript">
      window.onload = function () {
        document.getElementById("fastlink-form").submit();
      };
    </script>
  </body>
</html>`;
}

/**
 * The origin of the FastLink URL, used as the base URL when loading the generated
 * document so it does not get an opaque origin.
 */
export function fastLinkOrigin(fastlinkUrl: string): string | undefined {
  try {
    return new URL(fastlinkUrl).origin;
  } catch {
    return undefined;
  }
}
