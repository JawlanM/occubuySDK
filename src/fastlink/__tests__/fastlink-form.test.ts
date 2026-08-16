import { describe, expect, it } from "vitest";
import {
  bearerToken,
  buildExtraParams,
  buildFastLinkForm,
  encodeExtraParamValue,
  escapeHtmlAttribute,
  fastLinkOrigin
} from "../fastlink-form.js";
import type { FastLinkSession } from "../models.js";

/**
 * These cases are the cross-platform contract for FastLink form building.
 * The Swift, Kotlin and Dart suites mirror them by name.
 */

const session = (overrides: Partial<FastLinkSession> = {}): FastLinkSession => ({
  fastlinkUrl: "https://fastlink.example.test/authenticate/anz/fastlink",
  accessToken: "abc123",
  configName: "Verification",
  ...overrides
});

const RETURN_URL = "occubuy://fastlinkfinish";

describe("escapeHtmlAttribute", () => {
  it("escapes the five attribute-significant characters", () => {
    expect(escapeHtmlAttribute(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes ampersands before the entities it introduces", () => {
    // A naive ordering would double-escape into &amp;lt;
    expect(escapeHtmlAttribute("a&b<c")).toBe("a&amp;b&lt;c");
  });
});

describe("encodeExtraParamValue", () => {
  it("percent-encodes reserved characters by default", () => {
    expect(encodeExtraParamValue("a&b=c")).toBe("a%26b%3Dc");
    expect(encodeExtraParamValue("My Config")).toBe("My%20Config");
  });

  it("preserves :// when asked, so the intent URL stays literal", () => {
    expect(encodeExtraParamValue("occubuy://fastlinkfinish", true)).toBe(
      "occubuy://fastlinkfinish"
    );
  });

  it("still encodes other characters when preserving delimiters", () => {
    expect(encodeExtraParamValue("occubuy://finish?a b", true)).toBe(
      "occubuy://finish%3Fa%20b"
    );
  });
});

describe("bearerToken", () => {
  it("adds the prefix when absent", () => {
    expect(bearerToken("abc123")).toBe("Bearer abc123");
  });

  it("does not double the prefix when the backend already added it", () => {
    expect(bearerToken("Bearer abc123")).toBe("Bearer abc123");
    expect(bearerToken("bearer abc123")).toBe("bearer abc123");
  });

  it("trims surrounding whitespace", () => {
    expect(bearerToken("  abc123  ")).toBe("Bearer abc123");
  });
});

describe("buildExtraParams", () => {
  it("emits configName then intentUrl", () => {
    expect(buildExtraParams(session(), RETURN_URL)).toBe(
      "configName=Verification&intentUrl=occubuy://fastlinkfinish"
    );
  });

  it("uses the configured scheme for the intent URL", () => {
    expect(buildExtraParams(session(), "partnerapp://fastlinkfinish")).toContain(
      "intentUrl=partnerapp://fastlinkfinish"
    );
  });

  it("percent-encodes a configName containing a separator", () => {
    const params = buildExtraParams(session({ configName: "A&B" }), RETURN_URL);
    expect(params).toBe("configName=A%26B&intentUrl=occubuy://fastlinkfinish");
  });

  it("omits configName when the backend did not supply one", () => {
    expect(buildExtraParams(session({ configName: undefined }), RETURN_URL)).toBe(
      "intentUrl=occubuy://fastlinkfinish"
    );
  });

  it("appends backend-supplied extras", () => {
    const params = buildExtraParams(
      session({ extraParams: { flow: "add", keyword: "anz" } }),
      RETURN_URL
    );
    expect(params).toBe(
      "configName=Verification&intentUrl=occubuy://fastlinkfinish&flow=add&keyword=anz"
    );
  });

  it("orders extras deterministically regardless of backend key order", () => {
    const forward = buildExtraParams(session({ extraParams: { a: "1", z: "2" } }), RETURN_URL);
    const reverse = buildExtraParams(session({ extraParams: { z: "2", a: "1" } }), RETURN_URL);
    expect(forward).toBe(reverse);
    expect(forward.endsWith("a=1&z=2")).toBe(true);
  });

  it("ignores extras that would override the reserved keys", () => {
    const params = buildExtraParams(
      session({ extraParams: { configName: "hijacked", intentUrl: "evil://x" } }),
      RETURN_URL
    );
    expect(params).toBe("configName=Verification&intentUrl=occubuy://fastlinkfinish");
  });
});

describe("buildFastLinkForm", () => {
  it("quotes the action attribute", () => {
    const html = buildFastLinkForm(session(), RETURN_URL);
    expect(html).toContain(
      'action="https://fastlink.example.test/authenticate/anz/fastlink"'
    );
  });

  it("prefixes the access token with Bearer", () => {
    const html = buildFastLinkForm(session(), RETURN_URL);
    expect(html).toContain('name="accessToken" value="Bearer abc123"');
  });

  it("escapes the ampersand separating extraParams", () => {
    const html = buildFastLinkForm(session(), RETURN_URL);
    expect(html).toContain(
      'value="configName=Verification&amp;intentUrl=occubuy://fastlinkfinish"'
    );
  });

  it("escapes a quote in the access token so it cannot break out of the attribute", () => {
    const html = buildFastLinkForm(session({ accessToken: 'a"onerror="alert(1)' }), RETURN_URL);
    expect(html).not.toContain('value="Bearer a"onerror="');
    expect(html).toContain("&quot;onerror=&quot;");
  });

  it("escapes angle brackets in the FastLink URL", () => {
    const html = buildFastLinkForm(
      session({ fastlinkUrl: "https://evil.example/<script>" }),
      RETURN_URL
    );
    expect(html).not.toContain("<script>a");
    expect(html).toContain("&lt;script&gt;");
  });

  it("auto-submits on load", () => {
    const html = buildFastLinkForm(session(), RETURN_URL);
    expect(html).toContain("window.onload");
    expect(html).toContain('document.getElementById("fastlink-form").submit()');
  });

  it("rejects a session with no URL", () => {
    expect(() => buildFastLinkForm(session({ fastlinkUrl: "" }), RETURN_URL)).toThrow(
      /missing a URL/
    );
  });

  it("rejects a session with no access token", () => {
    expect(() => buildFastLinkForm(session({ accessToken: "" }), RETURN_URL)).toThrow(
      /missing an access token/
    );
  });
});

describe("fastLinkOrigin", () => {
  it("returns the origin of a valid URL", () => {
    expect(fastLinkOrigin("https://fastlink.example.test/authenticate/anz/fastlink")).toBe(
      "https://fastlink.example.test"
    );
  });

  it("returns undefined for an unparseable URL", () => {
    expect(fastLinkOrigin("not a url")).toBeUndefined();
  });
});
