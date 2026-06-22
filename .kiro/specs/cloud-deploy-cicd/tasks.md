# Implementation Plan: cloud-deploy-cicd

## Overview

Work is organized into the eight incremental, independently-testable phases from the design's "How phases map to requirements" table. Each phase lands on its own and ends with the explicit per-phase verification checkpoint from the design's "Per-phase verification" section. You can stop after any phase and have a strictly better repository than before.

Implementation language is JavaScript (Node ESM), matching the existing `"type": "module"` services and the design's `ci/lib/` ESM modules. Property tests use Vitest + `fast-check` (≥100 iterations), each tagged `// Feature: cloud-deploy-cicd, Property {n}: {text}`.

Correctness-critical pure logic lives under `ci/lib/`: `tags.js` (Phase 4), `secrets.js` + `token.js` (Phase 6), `compose-ports.js` (Phase 7), `pinning.js` + consistency check (Phase 8). Each ships with its property test referencing the design's Property number.

## Tasks

- [x] 1. Phase 1 — Vitest + ESLint per service (Req 1, 2)
  - [x] 1.1 Configure Vitest and a first test for `mcp-server`
    - Add `vitest` as a devDependency in `mcp-server/package.json` (pin a Node 20.18-compatible version)
    - Add `"test": "vitest run"` script (single-run, non-watch; non-zero exit when no tests found via default `passWithNoTests: false`)
    - Add at least one honest unit test (`mcp-server/*.test.js`) exercising real exported module logic, not a tautology, so the green build is non-vacuous
    - Keep `"type": "module"` unchanged; rely on Vitest native ESM
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.2 Configure ESLint for `mcp-server`
    - Add `eslint` as a devDependency and a flat `mcp-server/eslint.config.js` with `languageOptions.sourceType: "module"`, targeting `**/*.{js,jsx,mjs}` and ignoring `node_modules`, `dist`
    - Add `"lint": "eslint ."` script (stylish formatter reports file path, line, column, rule id; exit 0 when clean)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 1.3 Configure Vitest and a first test for `orchestrator`
    - Add `vitest` devDependency and `"test": "vitest run"` to `orchestrator/package.json`
    - Add at least one honest unit test (`orchestrator/*.test.js`) over real module logic
    - Keep `"type": "module"` unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.4 Configure ESLint for `orchestrator`
    - Add `eslint` devDependency and flat `orchestrator/eslint.config.js` (module sourceType, ignore `node_modules`/`dist`)
    - Add `"lint": "eslint ."` script
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 1.5 Configure Vitest and a first test for `frontend`
    - Add `vitest` devDependency and `"test": "vitest run"` to `frontend/package.json`
    - Add at least one honest unit test (`frontend/src/*.test.js(x)`) over real logic; configure `jsdom`/`environment` only if a test renders JSX
    - Keep Vite 5 / React 18 pins intact for Node 20.18 compatibility; do not upgrade Vite past the Node 20.19 requirement
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.6 Configure ESLint for `frontend` (JSX-aware)
    - Add `eslint` and `eslint-plugin-react` devDependencies; flat `frontend/eslint.config.js` enabling JSX parsing (`parserOptions.ecmaFeatures.jsx`) and React plugin for `.jsx`
    - Target `**/*.{js,jsx,mjs}`, ignore `node_modules`, `dist`; add `"lint": "eslint ."` script
    - _Requirements: 2.1, 2.2, 2.4_

  - [x] 1.7 Checkpoint — verify Phase 1
    - Run `npm install && npm run lint && npm test` in each of `mcp-server/`, `orchestrator/`, `frontend/` and confirm all three are green. Ask the user if questions arise.

- [x] 2. Phase 2 — CI lint/test matrix (Req 3)
  - [x] 2.1 Create `.github/workflows/ci.yml` lint/test matrix
    - Trigger on `push` to `main` and `pull_request` targeting `main`
    - Single job with matrix `service ∈ {mcp-server, orchestrator, frontend} × script ∈ {lint, test}` → six independent jobs; set `fail-fast: false`
    - Each cell: checkout, setup Node 20, `npm ci` in the service dir, then `npm run <script>`; `timeout-minutes: 15`
    - A failed `npm ci`, `lint`, or `test` fails that cell and names the service via the matrix label
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 2.5, 2.6_

  - [x] 2.2 Checkpoint — verify Phase 2
    - Open a PR to `main`; confirm six checks (3 services × 2 scripts) run, siblings finish when one fails, and status reports correctly. Ask the user if questions arise.

- [x] 3. Phase 3 — arm64 Docker build verification (Req 4)
  - [x] 3.1 Add `build-verify` job to `ci.yml`
    - Use `docker/setup-qemu-action@v3` + `docker/setup-buildx-action@v3`; build `mcp-server`, `orchestrator`, and root-context `nginx/Dockerfile` for `platforms: linux/arm64` with `push: false`
    - Any failing image fails the job and names the offending image; per-step `timeout-minutes: 30` enforces the 1800s budget
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [x] 3.2 Add nginx widget-asset extraction step
    - Build the frontend stage with `docker buildx build --target <frontend-build-stage> --output type=local,dest=./_widget` and assert `widget.js` and `widget.css` exist with non-zero size; fail the job otherwise
    - _Requirements: 4.4_

  - [x] 3.3 Checkpoint — verify Phase 3
    - Push a commit; confirm the build job synth-builds all three arm64 images and nginx yields non-empty `widget.js`/`widget.css`. Ask the user if questions arise.

- [x] 4. Phase 4 — Publish images to GHCR (Req 5)
  - [x] 4.1 Implement `ci/lib/tags.js` and CI Vitest setup for `ci/lib/`
    - Implement `deriveTags(fullSha)` → `{ sha7: first 7 chars, latest: "latest" }`
    - Add a root/`ci` Vitest config (plus `fast-check` devDependency) so `ci/lib/*.test.js` run independently of the three services
    - _Requirements: 5.2_

  - [x]* 4.2 Write property test for tag derivation
    - **Property 1: Short-SHA tag derivation** — for any 40-char hex SHA, `sha7` is exactly the first 7 chars (length 7, prefix of input) and `latest` is constant
    - Tag: `// Feature: cloud-deploy-cicd, Property 1: ...`; generator `fc.hexaString({minLength:40,maxLength:40})`; `numRuns: 100`
    - **Validates: Requirements 5.2**

  - [x]* 4.3 Write unit tests for `tags.js`
    - Cover concrete/edge cases (lowercase/uppercase hex, known SHA → known sha7)
    - _Requirements: 5.2_

  - [x] 4.4 Create `.github/workflows/deploy.yml` publish job
    - Trigger only on `push` to `main` gated on a passing CI run; `permissions: packages: write`
    - `docker/login-action` to `ghcr.io` with `GITHUB_TOKEN` (fail closed, no push, no CD on login failure); compute tags via `node ci/lib/tags.js <full-sha>`
    - `docker/build-push-action` `platforms: linux/arm64`, `push: true`, tags `…:<sha7>` and `…:latest` for `mcp-server`, `orchestrator`, `nginx` only (never `kiro-gateway`); 3 retries for transient errors; per-image push `timeout-minutes: 10`; any push failure stops before CD
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6_

  - [x] 4.5 Checkpoint — verify Phase 4
    - Merge to `main`; confirm three GHCR packages appear tagged `sha7` + `latest`. Ask the user if questions arise.

- [ ] 5. Phase 5 — CD over SSH (Req 6)
  - [x] 5.1 Add `deploy` job (`needs: publish`) to `deploy.yml`
    - Key-based SSH to the A1 VM using the private key from `Secret_Store`; SSH auth failure aborts before delivering any artifact and reports an auth failure
    - `scp` `docker-compose.yml` + `docker-compose.prod.yml` to `/opt/openproject-agent`; run `docker compose pull` — on pull failure, abort and leave the prior stack untouched
    - Run `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` only after a successful pull (rolling recreate preserves prior stack on failure)
    - Poll `http://localhost:8080` at ≤10s intervals up to 120s; first non-error HTTP response = success, otherwise report failed deployment
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [ ] 5.2 Checkpoint — verify Phase 5
    - Trigger a deploy; confirm the VM answers healthy on `:8080`, and a forced pull failure leaves the old stack running. Ask the user if questions arise.

- [ ] 6. Phase 6 — Secrets and Kiro token (Req 7, 8)
  - [x] 6.1 Implement `ci/lib/secrets.js`
    - `validateSecrets(env)` → `{ ok, missing }` over the five required secrets (`OPENPROJECT_API_TOKEN`, `ANTHROPIC_API_KEY`, `PROFILE_ARN`, `CLAUDE_MODEL`, `OPENPROJECT_SECRET_KEY_BASE`), treating absent/empty as missing
    - `.env` rendering helper producing exactly one `NAME=value` line per required secret and no others
    - _Requirements: 7.1, 7.2, 7.7_

  - [x]* 6.2 Write property test for secret completeness validation
    - **Property 2: Secret completeness validation** — `ok = true` with empty `missing` iff all five required names are present and non-empty; otherwise `missing` contains exactly the absent/empty required names and no others
    - Tag `// Feature: cloud-deploy-cicd, Property 2: ...`; record generators with random subsets omitted/blanked; `numRuns: 100`
    - **Validates: Requirements 7.1, 7.7**

  - [x]* 6.3 Write property test for `.env` rendering
    - **Property 3: Environment file rendering** — for any complete mapping, the rendered content has exactly one `NAME=value` line per required secret with the supplied value and no line for any name outside the required set
    - Tag `// Feature: cloud-deploy-cicd, Property 3: ...`; `numRuns: 100`
    - **Validates: Requirements 7.2**

  - [x]* 6.4 Write unit tests for `secrets.js`
    - Edge cases: all present, single missing, empty-string value, extra non-required names ignored
    - _Requirements: 7.1, 7.2, 7.7_

  - [x] 6.5 Implement `ci/lib/token.js`
    - `classifyToken(raw, now)` → `{ class, expiresAt? }` with `WARN_WINDOW_MS = 72h`; classes `missing` / `expired` / `expiring_soon` / `ok`; isolate the expiry field lookup from the real `kiro-auth-token.json` shape
    - _Requirements: 8.6, 8.7, 8.8_

  - [x]* 6.6 Write property test for Kiro token expiry classification
    - **Property 4: Kiro token expiry classification** — `missing` when absent/empty/unparseable; `expired` when expiry ≤ now; `expiring_soon` when now < expiry ≤ now+72h; `ok` when expiry > now+72h
    - Tag `// Feature: cloud-deploy-cicd, Property 4: ...`; `fc.date()` offsets around `now` and `now+72h` including exact boundaries; `numRuns: 100`
    - **Validates: Requirements 8.6, 8.7, 8.8**

  - [x]* 6.7 Write unit tests for `token.js`
    - Real `kiro-auth-token.json` field shape, exact 72h boundary timestamp, malformed JSON
    - _Requirements: 8.6, 8.7, 8.8_

  - [x] 6.8 Wire secrets + token preflight and delivery into `deploy.yml` CD
    - Run `node ci/lib/secrets.js` and `node ci/lib/token.js` as preflight before any VM write; missing secrets / missing token / expired token halts before writing (expiring-soon warns and proceeds); GitHub masks all secret values in logs
    - Write `.env` via SSH heredoc with `umask 077` then `chmod 600`, using temp file + atomic `mv` (failure removes temp file, no partial `.env`); `.env` and token remain git-ignored
    - Write Kiro token to `~/.aws/sso/cache/kiro-auth-token.json` at `0600`; write failure halts without restarting gateway and leaves prior token; on success restart `kiro-gateway` and fail naming it if not running within 60s
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ] 6.9 Checkpoint — verify Phase 6
    - Run a deploy; confirm `.env` and token written `0600`, gateway restarts, and an expiring/expired token surfaces the documented warning/halt. Ask the user if questions arise.

- [ ] 7. Phase 7 — Production hardening (Req 9)
  - [ ] 7.1 Create `docker-compose.prod.yml` overlay
    - Define services so only `nginx` publishes a host port; keep `mcp-server` (3000), `orchestrator` (4000), `kiro-gateway` (8000) reachable only on the internal Docker network with zero host port bindings
    - Add opt-in TLS: map `443:443` (and `80:80` for HTTP→HTTPS redirect) on nginx behind a documented env flag with mounted certs
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6_

  - [ ] 7.2 Implement `ci/lib/compose-ports.js`
    - `checkComposePorts(services, publicService = "nginx")` → `{ compliant, violators }`; a host port binding is any `ports` entry publishing to the host (`"8080:80"` string or `{published, target}` long form); `expose`-only and no `ports` are compliant
    - _Requirements: 9.2, 9.5_

  - [ ]* 7.3 Write property test for production port-binding compliance
    - **Property 5: Production port-binding compliance** — `compliant = true` with no violators iff no non-`nginx` service declares a host port binding; otherwise `violators` contains exactly the offending non-`nginx` services and no others
    - Tag `// Feature: cloud-deploy-cicd, Property 5: ...`; compose-service arrays with randomized `ports` presence and names (including/excluding `nginx`); `numRuns: 100`
    - **Validates: Requirements 9.1, 9.2, 9.5**

  - [ ]* 7.4 Write unit tests for `compose-ports.js`
    - Short-form string port vs long-form `{published, target}`, `expose`-only, no `ports`, multiple violators
    - _Requirements: 9.2, 9.5_

  - [ ] 7.5 Wire port-compliance gate into the pipeline before stack start
    - Parse the effective merged prod compose and run `checkComposePorts`; refuse to start the stack and name each violator when non-compliant
    - _Requirements: 9.4, 9.5_

  - [ ] 7.6 Checkpoint — verify Phase 7
    - From the VM host, confirm 3000/4000/8000 refuse connections while 8080 (or 443) answers, and `checkComposePorts` flags any stray host port. Ask the user if questions arise.

- [ ] 8. Phase 8 — Reproducibility and documentation (Req 10)
  - [ ] 8.1 Pin first-party Dockerfile base images
    - Move `mcp-server`, `orchestrator`, and `nginx` Dockerfiles from `node:20-alpine` to a patch-pinned tag (e.g. `node:20.18-alpine3.xx`) / digest so two builds from the same commit differ only by env values
    - _Requirements: 10.3_

  - [ ] 8.2 Implement `ci/lib/pinning.js`
    - `checkPinning(builds)` → `{ reproducible, offenders }`; `FROM` with no tag or `latest` → `unpinned_base`; missing committed lockfile → `missing_lockfile`
    - _Requirements: 10.3, 10.4_

  - [ ]* 8.3 Write property test for reproducibility pinning
    - **Property 7: Reproducibility pinning** — `reproducible = true` with no offenders iff every build's `FROM` is pinned to an explicit non-`latest` version/digest and every build has a committed lockfile; otherwise `offenders` contains exactly the violating builds each annotated with the correct reason
    - Tag `// Feature: cloud-deploy-cicd, Property 7: ...`; Dockerfile-text builders with pinned/unpinned `FROM` and lockfile flags; `numRuns: 100`
    - **Validates: Requirements 10.3, 10.4**

  - [ ]* 8.4 Write unit tests for `pinning.js`
    - `FROM node:20-alpine` treated as unpinned (no patch version), missing lockfile, fully pinned + lockfile passes
    - _Requirements: 10.3, 10.4_

  - [ ] 8.5 Wire pinning gate into CD
    - Run `node ci/lib/pinning.js` before deployment; stop and name the offending image when any first-party image is unpinned or missing a lockfile, leaving the prior stack unchanged
    - _Requirements: 10.4_

  - [ ] 8.6 Author `docs/deployment.md`
    - List every `Secret_Store` entry with name + purpose; state CI_Stage and CD_Stage trigger conditions; document the steps to reproduce the deploy with no undocumented manual step
    - _Requirements: 10.1, 10.5_

  - [ ] 8.7 Implement docs/pipeline consistency check and wire it into CI
    - Extract documented sets (secret names, triggers, first-party image names) from `docs/deployment.md` and the corresponding sets from the workflow files; pass iff the two sets are equal (empty symmetric difference); add as a CI doc-consistency check
    - _Requirements: 10.2_

  - [ ]* 8.8 Write property test for documentation/pipeline consistency
    - **Property 6: Documentation/pipeline consistency** — for paired documented/pipeline sets, the check passes iff the two sets are equal (every documented item present in pipeline config and vice versa)
    - Tag `// Feature: cloud-deploy-cicd, Property 6: ...`; paired sets with injected symmetric differences; `numRuns: 100`
    - **Validates: Requirements 10.2**

  - [ ] 8.9 Checkpoint — verify Phase 8
    - Run `node ci/lib/pinning.js` against the pinned Dockerfiles (passes) and a deliberately unpinned one (fails); confirm the docs/pipeline consistency check passes. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (property, unit, and integration tests) and can be skipped for a faster MVP; core implementation tasks are never optional.
- The eight phases are sequential and each is independently landable; per-phase checkpoints (x.7 / x.2 / x.3 / x.5 / x.6 / x.9) capture the design's standalone verification for that phase.
- Each property test references its design Property number and the requirements clause it validates, uses `fast-check` with `numRuns: 100`, and carries the `// Feature: cloud-deploy-cicd, Property {n}: {text}` tag.
- `kiro-gateway` is third-party and is never built or pushed — only `mcp-server`, `orchestrator`, and `nginx` are first-party images.
- The `ci/lib/` modules are pure ESM with no service dependencies and are tested by a root/`ci` Vitest config independent of the three services.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.5"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.6"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.2"] },
    { "id": 7, "tasks": ["4.3", "4.4"] },
    { "id": 8, "tasks": ["5.1"] },
    { "id": 9, "tasks": ["6.1", "6.5"] },
    { "id": 10, "tasks": ["6.2", "6.6"] },
    { "id": 11, "tasks": ["6.3", "6.7"] },
    { "id": 12, "tasks": ["6.4"] },
    { "id": 13, "tasks": ["6.8"] },
    { "id": 14, "tasks": ["7.1", "7.2"] },
    { "id": 15, "tasks": ["7.3"] },
    { "id": 16, "tasks": ["7.4", "7.5"] },
    { "id": 17, "tasks": ["8.1", "8.2", "8.6"] },
    { "id": 18, "tasks": ["8.3", "8.7"] },
    { "id": 19, "tasks": ["8.4", "8.8", "8.5"] }
  ]
}
```
