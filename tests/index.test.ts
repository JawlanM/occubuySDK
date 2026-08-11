import { describe, it, expect, vi } from "vitest";
import { init } from "../src/index";

describe("OccubuyScore.init", () => {
  it("throws without an apiKey", () => {
    // @ts-expect-error intentionally missing apiKey for the test
    expect(() => init({})).toThrow();
  });

  it("returns a start() function when given an apiKey", () => {
    const instance = init({ apiKey: "pk_sandbox_test" });
    expect(typeof instance.start).toBe("function");
  });

  it("defaults environment to sandbox", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const instance = init({ apiKey: "pk_sandbox_test" });
    instance.start();
    expect(logSpy).toHaveBeenCalledWith(
      "[OccubuyScore] start() called",
      expect.objectContaining({ environment: "sandbox" })
    );
    logSpy.mockRestore();
  });
});
