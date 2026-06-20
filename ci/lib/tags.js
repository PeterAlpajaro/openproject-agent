// Derive container image tags from a git commit SHA.
//
// Pure, dependency-free logic so the pipeline's tag scheme is unit- and
// property-testable instead of being buried in workflow YAML. The publish
// workflow runs this as a CLI to obtain the short SHA.

const FULL_SHA = /^[0-9a-fA-F]{40}$/;

// deriveTags(fullSha) -> { sha7, latest }
//   sha7   = the first 7 characters of the 40-char commit SHA
//   latest = the constant moving tag "latest"
export function deriveTags(fullSha) {
  if (typeof fullSha !== "string" || !FULL_SHA.test(fullSha)) {
    throw new Error(
      `deriveTags expected a 40-character hex commit SHA, received: ${String(fullSha)}`
    );
  }
  return { sha7: fullSha.slice(0, 7), latest: "latest" };
}

// CLI entry point: prints the short SHA so a workflow step can capture it.
//   usage: node ci/lib/tags.js <full-40-char-sha>
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(deriveTags(process.argv[2]).sha7);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
