import { describe, it, expect } from "vitest";
import { normalizeOrigin, normalizeOriginList, isLocalDevOrigin } from "../src/utils/origins";

// Same table in sdk-scaffold backend/tests/origins.test.ts and occubuy-integration
// server/allowed-origins.test.ts - the portal cleans the list, the SDK backend re-checks it
// and compares it to the browser's Origin header, so both must agree on every case.
const CASES: Array<[input: string, expected: string | null]> = [
  ["https://jmrealestate.com.au", "https://jmrealestate.com.au"],
  ["https://JMRealestate.com.au/", "https://jmrealestate.com.au"],
  ["  https://jmrealestate.com.au  ", "https://jmrealestate.com.au"],
  ["https://www.jmrealestate.com.au:443", "https://www.jmrealestate.com.au"],
  ["http://localhost:3000", "http://localhost:3000"],
  ["http://127.0.0.1:8787/", "http://127.0.0.1:8787"],
  ["https://jmrealestate.com.au:8443", "https://jmrealestate.com.au:8443"],
  ["https://bücher.example", "https://xn--bcher-kva.example"],
  ["https://jmrealestate.com.au/apply", null],
  ["https://jmrealestate.com.au/?ref=x", null],
  ["https://jmrealestate.com.au/#top", null],
  ["https://user:pass@jmrealestate.com.au", null],
  ["ftp://jmrealestate.com.au", null],
  ["javascript:alert(1)", null],
  ["jmrealestate.com.au", null],
  ["not a website", null],
  ["", null],
];

describe("normalizeOrigin", () => {
  it.each(CASES)("%j -> %j", (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });

  it("returns null for non-strings", () => {
    for (const value of [undefined, null, 42, {}, ["https://x.com"]]) expect(normalizeOrigin(value)).toBeNull();
  });
});

describe("normalizeOriginList", () => {
  it("normalises and de-duplicates", () => {
    expect(normalizeOriginList(["https://A.com/", "https://a.com", "http://localhost:5500"])).toEqual([
      "https://a.com",
      "http://localhost:5500",
    ]);
  });

  it("rejects the whole list if any entry is bad, or if it isn't a list", () => {
    expect(normalizeOriginList(["https://a.com", "https://a.com/path"])).toBeNull();
    expect(normalizeOriginList("https://a.com")).toBeNull();
    expect(normalizeOriginList([42])).toBeNull();
  });

  it("allows an empty list (partner cleared it)", () => {
    expect(normalizeOriginList([])).toEqual([]);
  });
});

describe("isLocalDevOrigin", () => {
  it("is only localhost / 127.0.0.1", () => {
    expect(isLocalDevOrigin("http://localhost:5500")).toBe(true);
    expect(isLocalDevOrigin("http://127.0.0.1:8787")).toBe(true);
    expect(isLocalDevOrigin("https://localhost.evil.example")).toBe(false);
    expect(isLocalDevOrigin("https://jmrealestate.com.au")).toBe(false);
    expect(isLocalDevOrigin("garbage")).toBe(false);
  });
});
