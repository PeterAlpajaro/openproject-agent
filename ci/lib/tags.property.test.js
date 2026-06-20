import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { deriveTags } from "./tags.js";

// Feature: cloud-deploy-cicd, Property 1: For any 40-character hexadecimal
// commit SHA, deriveTags returns a sha7 that is exactly the first 7 characters
// of the input (length 7 and a prefix of the full SHA) and a constant `latest`
// tag, regardless of the SHA's content.
// Validates: Requirements 5.2
describe("Property 1: short-SHA tag derivation", () => {
  it("sha7 is the 7-char prefix and latest is constant for any 40-char hex SHA", () => {
    fc.assert(
      fc.property(
        fc.hexaString({ minLength: 40, maxLength: 40 }),
        (fullSha) => {
          const { sha7, latest } = deriveTags(fullSha);
          expect(sha7).toHaveLength(7);
          expect(fullSha.startsWith(sha7)).toBe(true);
          expect(sha7).toBe(fullSha.slice(0, 7));
          expect(latest).toBe("latest");
        }
      ),
      { numRuns: 100 }
    );
  });
});
