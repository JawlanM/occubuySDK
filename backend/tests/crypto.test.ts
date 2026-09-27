import { describe, it, expect, afterEach, vi } from "vitest";
import { hashSecret, isProduction } from "../src/utils/crypto";

const saved = { pepper: process.env.OCCUBUY_HASH_PEPPER, node: process.env.NODE_ENV, render: process.env.RENDER };
afterEach(() => {
  for (const [key, value] of [["OCCUBUY_HASH_PEPPER", saved.pepper], ["NODE_ENV", saved.node], ["RENDER", saved.render]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe("hash pepper", () => {
  it("production without a pepper refuses to hash instead of using the public dev value", () => {
    delete process.env.OCCUBUY_HASH_PEPPER;
    process.env.RENDER = "true";
    expect(isProduction()).toBe(true);
    expect(() => hashSecret("pk_sandbox_x_abc")).toThrow(/OCCUBUY_HASH_PEPPER/);

    delete process.env.RENDER;
    process.env.NODE_ENV = "production";
    expect(() => hashSecret("pk_sandbox_x_abc")).toThrow(/OCCUBUY_HASH_PEPPER/);
  });

  it("local dev without a pepper still works, and a set pepper changes the hash", () => {
    delete process.env.OCCUBUY_HASH_PEPPER;
    delete process.env.RENDER;
    process.env.NODE_ENV = "test";
    const devHash = hashSecret("pk_sandbox_x_abc");
    process.env.OCCUBUY_HASH_PEPPER = "real-pepper";
    expect(hashSecret("pk_sandbox_x_abc")).not.toBe(devHash);
  });
});
