// Kiro auth token parsing and expiry classification.
//
// Pure logic so it is unit- and property-testable. The deploy workflow uses
// the CLI to fail fast on a missing/unparseable token and to surface the
// token's expiry classification.
//
// NOTE: the real kiro-auth-token.json exposes only `expiresAt` (the ACCESS
// token's expiry, which is short-lived and auto-refreshed by the gateway via
// the refresh token). There is no refresh-token-expiry field, so the design's
// notion of warning on refresh-token expiry cannot be computed from this file.
// We classify on `expiresAt`; the deploy treats only `missing` as fatal and
// surfaces the rest as information.

export const WARN_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 hours

// classifyToken(raw, now) -> { class, expiresAt? }
//   raw : the token file contents (string) or undefined
//   now : reference time in epoch ms
//   class:
//     "missing"       - absent, empty, unparseable, or no usable expiry
//     "expired"       - expiresAt <= now
//     "expiring_soon" - now < expiresAt <= now + 72h
//     "ok"            - expiresAt > now + 72h
export function classifyToken(raw, now) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { class: "missing" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { class: "missing" };
  }
  const iso = parsed?.expiresAt;
  if (typeof iso !== "string") {
    return { class: "missing" };
  }
  const expiresAt = Date.parse(iso);
  if (Number.isNaN(expiresAt)) {
    return { class: "missing" };
  }
  if (expiresAt <= now) {
    return { class: "expired", expiresAt };
  }
  if (expiresAt <= now + WARN_WINDOW_MS) {
    return { class: "expiring_soon", expiresAt };
  }
  return { class: "ok", expiresAt };
}

// CLI: reads the token from the KIRO_AUTH_TOKEN env var, prints the class,
// and exits non-zero only when the token is missing/unparseable.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = classifyToken(process.env.KIRO_AUTH_TOKEN, Date.now());
  process.stdout.write(`${result.class}\n`);
  if (result.class === "missing") {
    process.stderr.write("Kiro token is missing or unparseable.\n");
    process.exit(1);
  }
}
