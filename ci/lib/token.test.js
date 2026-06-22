import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classifyToken, WARN_WINDOW_MS } from "./token.js";

const NOW = Date.parse("2026-06-21T00:00:00Z");
const tokenWithExpiry = (iso) => JSON.stringify({ accessToken: "a", refreshToken: "r", expiresAt: iso });

describe("classifyToken (unit)", () => {
  it("missing when undefined or empty", () => {
    expect(classifyToken(undefined, NOW).class).toBe("missing");
    expect(classifyToken("", NOW).class).toBe("missing");
    expect(classifyToken("   ", NOW).class).toBe("missing");
  });

  it("missing when not valid JSON", () => {
    expect(classifyToken("{not json", NOW).class).toBe("missing");
  });

  it("missing when there is no expiresAt field", () => {
    expect(classifyToken(JSON.stringify({ accessToken: "a" }), NOW).class).toBe("missing");
  });

  it("expired when expiresAt is at or before now", () => {
    expect(classifyToken(tokenWithExpiry("2026-06-21T00:00:00Z"), NOW).class).toBe("expired");
    expect(classifyToken(tokenWithExpiry("2026-06-20T00:00:00Z"), NOW).class).toBe("expired");
  });

  it("expiring_soon within the 72h window", () => {
    const iso = new Date(NOW + 24 * 60 * 60 * 1000).toISOString();
    expect(classifyToken(tokenWithExpiry(iso), NOW).class).toBe("expiring_soon");
  });

  it("ok beyond the 72h window", () => {
    const iso = new Date(NOW + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(classifyToken(tokenWithExpiry(iso), NOW).class).toBe("ok");
  });

  it("the 72h boundary is inclusive of expiring_soon", () => {
    const iso = new Date(NOW + WARN_WINDOW_MS).toISOString();
    expect(classifyToken(tokenWithExpiry(iso), NOW).class).toBe("expiring_soon");
  });
});

// Feature: cloud-deploy-cicd, Property 4: For any token input and reference
// time now, classifyToken returns missing when absent/empty/unparseable;
// expired when expiry <= now; expiring_soon when now < expiry <= now+72h; ok
// when expiry > now+72h.
// Validates: Requirements 8.6, 8.7, 8.8
describe("Property 4: Kiro token expiry classification", () => {
  it("classifies by the relationship between expiresAt and now", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }), // now, ms (kept small; offset dominates)
        fc.integer({ min: -10 * 24 * 60 * 60 * 1000, max: 10 * 24 * 60 * 60 * 1000 }),
        (now, offset) => {
          const expiresAt = now + offset;
          const raw = tokenWithExpiry(new Date(expiresAt).toISOString());
          const { class: cls } = classifyToken(raw, now);
          // Recompute expected from the ISO round-trip to avoid sub-ms drift.
          const reparsed = Date.parse(new Date(expiresAt).toISOString());
          let expected;
          if (reparsed <= now) expected = "expired";
          else if (reparsed <= now + WARN_WINDOW_MS) expected = "expiring_soon";
          else expected = "ok";
          expect(cls).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("any non-token input classifies as missing", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(undefined), fc.constant(""), fc.string()), (raw) => {
        // Strings that happen to be JSON with a valid expiresAt are not "missing";
        // exclude those so the property targets genuinely unusable inputs.
        let usable = false;
        if (typeof raw === "string" && raw.trim() !== "") {
          try {
            usable = typeof JSON.parse(raw)?.expiresAt === "string" && !Number.isNaN(Date.parse(JSON.parse(raw).expiresAt));
          } catch {
            usable = false;
          }
        }
        fc.pre(!usable);
        expect(classifyToken(raw, 0).class).toBe("missing");
      }),
      { numRuns: 100 }
    );
  });
});
