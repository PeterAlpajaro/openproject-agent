// Validation and .env rendering for the secrets the agent stack consumes.
//
// Pure logic so it is unit- and property-testable. The deploy workflow runs
// this as a CLI to (a) fail fast when a required secret is missing and
// (b) render the .env that gets written to the VM.
//
// NOTE: these are the variables actually consumed by docker-compose.yml.
// OPENPROJECT_SECRET_KEY_BASE (in the design's list) belongs to the separate
// OpenProject stack's own .env, not this one, so it is intentionally excluded.

export const REQUIRED_SECRETS = [
  "OPENPROJECT_API_TOKEN",
  "ANTHROPIC_API_KEY",
  "PROFILE_ARN",
  "CLAUDE_MODEL",
];

// A value counts as present only if it is a non-empty string.
function isPresent(value) {
  return typeof value === "string" && value.length > 0;
}

// validateSecrets(env) -> { ok, missing }
//   ok      = every required secret is present and non-empty
//   missing = exactly the required names that are absent or empty (in order)
export function validateSecrets(env) {
  const source = env ?? {};
  const missing = REQUIRED_SECRETS.filter((name) => !isPresent(source[name]));
  return { ok: missing.length === 0, missing };
}

// renderEnvFile(env) -> string
//   One `NAME=value` line per required secret, in REQUIRED_SECRETS order, with
//   a trailing newline. Throws if any required secret is missing so a partial
//   .env is never produced.
export function renderEnvFile(env) {
  const { ok, missing } = validateSecrets(env);
  if (!ok) {
    throw new Error(`Cannot render .env; missing required secrets: ${missing.join(", ")}`);
  }
  return REQUIRED_SECRETS.map((name) => `${name}=${env[name]}`).join("\n") + "\n";
}

// CLI: `check` validates; `render` prints the .env to stdout (only if valid).
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? "check";
  const { ok, missing } = validateSecrets(process.env);
  if (!ok) {
    process.stderr.write(`Missing required secrets: ${missing.join(", ")}\n`);
    process.exit(1);
  }
  if (mode === "render") {
    process.stdout.write(renderEnvFile(process.env));
  } else {
    process.stderr.write("All required secrets present.\n");
  }
}
