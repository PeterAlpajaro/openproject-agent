import { describe, it, expect } from "vitest";
import { deriveTags } from "./tags.js";

describe("deriveTags (unit)", () => {
  it("takes the first 7 characters as sha7 and a constant latest", () => {
    const full = "0123456789abcdef0123456789abcdef01234567";
    expect(deriveTags(full)).toEqual({ sha7: "0123456", latest: "latest" });
  });

  it("preserves the original case of the hex characters", () => {
    const full = "ABCDEF0123456789abcdef0123456789ABCDEF01";
    expect(deriveTags(full).sha7).toBe("ABCDEF0");
  });

  it("throws on a too-short SHA", () => {
    expect(() => deriveTags("abc1234")).toThrow();
  });

  it("throws on non-hex characters", () => {
    expect(() => deriveTags("z".repeat(40))).toThrow();
  });

  it("throws on non-string input", () => {
    expect(() => deriveTags(undefined)).toThrow();
    expect(() => deriveTags(null)).toThrow();
  });
});
