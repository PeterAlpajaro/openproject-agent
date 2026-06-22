import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validateSecrets, renderEnvFile, REQUIRED_SECRETS } from "./secrets.js";

// A fully-populated env with a non-empty value per required secret.
function fullEnv() {
  return Object.fromEntries(REQUIRED_SECRETS.map((n) => [n, `val-${n}`]));
}

describe("validateSecrets (unit)", () => {
  it("ok when every required secret is present and non-empty", () => {
    expect(validateSecrets(fullEnv())).toEqual({ ok: true, missing: [] });
  });

  it("reports a single missing secret by name", () => {
    const env = fullEnv();
    delete env.PROFILE_ARN;
    expect(validateSecrets(env)).toEqual({ ok: false, missing: ["PROFILE_ARN"] });
  });

  it("treats an empty string as missing", () => {
    const env = fullEnv();
    env.ANTHROPIC_API_KEY = "";
    expect(validateSecrets(env)).toEqual({ ok: false, missing: ["ANTHROPIC_API_KEY"] });
  });

  it("ignores extra, non-required names", () => {
    const env = { ...fullEnv(), UNRELATED: "x" };
    expect(validateSecrets(env).ok).toBe(true);
  });

  it("handles undefined env", () => {
    expect(validateSecrets(undefined).ok).toBe(false);
  });
});

describe("renderEnvFile (unit)", () => {
  it("renders one NAME=value line per required secret with a trailing newline", () => {
    const env = fullEnv();
    const out = renderEnvFile(env);
    for (const name of REQUIRED_SECRETS) {
      expect(out).toContain(`${name}=val-${name}`);
    }
    expect(out.endsWith("\n")).toBe(true);
    // Drop the single trailing newline rather than trimming (values may
    // legitimately contain whitespace).
    expect(out.slice(0, -1).split("\n")).toHaveLength(REQUIRED_SECRETS.length);
  });

  it("throws rather than emit a partial .env when a secret is missing", () => {
    const env = fullEnv();
    delete env.CLAUDE_MODEL;
    expect(() => renderEnvFile(env)).toThrow(/CLAUDE_MODEL/);
  });
});

// Feature: cloud-deploy-cicd, Property 2: For any mapping of env var names to
// values, validateSecrets reports ok=true with empty missing iff every
// required secret name is present with a non-empty value; otherwise missing
// contains exactly the required names whose value is absent or empty.
// Validates: Requirements 7.1, 7.7
describe("Property 2: secret completeness validation", () => {
  it("ok iff all required present; missing lists exactly the absent/empty ones", () => {
    // Generator: for each required secret choose present / empty / absent.
    const stateArb = fc.constantFrom("present", "empty", "absent");
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom(...REQUIRED_SECRETS),
          stateArb,
          { minKeys: 0, maxKeys: REQUIRED_SECRETS.length }
        ),
        fc.dictionary(fc.string(), fc.string()), // arbitrary extra names
        (states, extras) => {
          const env = { ...extras };
          for (const name of REQUIRED_SECRETS) {
            const state = states[name] ?? "absent";
            if (state === "present") env[name] = "nonempty";
            else if (state === "empty") env[name] = "";
            // "absent" -> leave unset
          }
          // Don't let an extra key accidentally collide with a required name.
          const expectedMissing = REQUIRED_SECRETS.filter(
            (n) => !(typeof env[n] === "string" && env[n].length > 0)
          );
          const result = validateSecrets(env);
          expect(result.missing).toEqual(expectedMissing);
          expect(result.ok).toBe(expectedMissing.length === 0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: cloud-deploy-cicd, Property 3: For any complete mapping that
// supplies a non-empty value for every required secret, the rendered .env
// contains exactly one NAME=value line per required secret, each line's value
// equals the supplied value, and there is no line for any name outside the set.
// Validates: Requirements 7.2
describe("Property 3: environment file rendering", () => {
  it("one correct NAME=value line per required secret and nothing else", () => {
    fc.assert(
      fc.property(
        // Values free of newlines and '=' ambiguity in the value position is fine.
        fc.dictionary(
          fc.constantFrom(...REQUIRED_SECRETS),
          fc.string({ minLength: 1 }).filter((s) => !s.includes("\n")),
          { minKeys: REQUIRED_SECRETS.length, maxKeys: REQUIRED_SECRETS.length }
        ),
        (values) => {
          // Ensure all required present and non-empty.
          fc.pre(REQUIRED_SECRETS.every((n) => typeof values[n] === "string" && values[n].length > 0));
          const out = renderEnvFile(values);
          // Drop the single trailing newline; do not trim (values may contain
          // leading/trailing whitespace).
          const lines = out.slice(0, -1).split("\n");
          expect(lines).toHaveLength(REQUIRED_SECRETS.length);
          const names = lines.map((l) => l.slice(0, l.indexOf("=")));
          expect(names.sort()).toEqual([...REQUIRED_SECRETS].sort());
          for (const name of REQUIRED_SECRETS) {
            expect(lines).toContain(`${name}=${values[name]}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
