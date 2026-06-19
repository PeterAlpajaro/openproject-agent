# Requirements Document

## Introduction

This feature automates the build, test, and deployment of the OpenProject AI Agent stack to an Oracle Cloud Ampere A1 (arm64) instance, replacing the current manual VPS process documented in the README. It introduces a CI/CD pipeline (assumed GitHub Actions) that lints and unit-tests each of the three Node/JS services, verifies that all Docker images build for the arm64 target, and delivers the running stack to the production VM. It also establishes secrets management for the `.env` values and the Kiro auth token, and addresses the Kiro token lifecycle that currently requires a manual `scp` re-copy.

The three application services (`mcp-server`, `orchestrator`, `frontend`) currently have no test runner. This feature adds Vitest as the unit test framework, since the project is ESM and Vite-based.

## Glossary

- **Pipeline**: The automated CI/CD system (assumed GitHub Actions) that runs on repository events.
- **CI_Stage**: The continuous integration portion of the Pipeline that lints, unit-tests, and verifies image builds.
- **CD_Stage**: The continuous deployment portion of the Pipeline that delivers and runs the stack on the Production_Server.
- **Service**: One of the three first-party Node/JS components — `mcp-server`, `orchestrator`, or `frontend`.
- **Test_Runner**: The unit test framework (Vitest) configured per Service.
- **Linter**: The static analysis tool configured per Service.
- **Image_Builder**: The component that builds Docker images targeting the `linux/arm64` platform.
- **Image_Registry**: The container registry that stores built images (assumed GitHub Container Registry / GHCR).
- **Production_Server**: The Oracle Cloud Ampere A1 (arm64) Ubuntu instance running the deployed stack.
- **Secret_Store**: The encrypted storage for sensitive values (assumed GitHub Actions repository/environment secrets).
- **Kiro_Token**: The Kiro auth token file (`kiro-auth-token.json`) consumed read-only by the `kiro-gateway` container.
- **Reverse_Proxy**: The `nginx` service, the only host-exposed public entry point.
- **Deployment_Artifact**: The set of Docker images and compose configuration needed to run the stack on the Production_Server.

## Requirements

### Requirement 1: Unit test framework per service

**User Story:** As a developer, I want a unit test runner configured for each Node/JS service, so that the Pipeline can verify service logic automatically.

#### Acceptance Criteria

1. THE Test_Runner SHALL be configured for the `mcp-server` Service, the `orchestrator` Service, and the `frontend` Service, where "configured" means the Vitest dependency is declared in that Service's `package.json` and the Service can invoke the Test_Runner without additional manual setup.
2. WHERE a Service has a configured Test_Runner, THE Service SHALL expose a `test` script in its `package.json` that runs the Test_Runner in single-run (non-watch) mode and terminates without waiting for file changes.
3. WHEN the `test` script is executed for a Service and all of that Service's unit tests pass, THE Test_Runner SHALL exit with status code 0.
4. WHEN the `test` script is executed for a Service, THE Test_Runner SHALL produce output that reports the total number of tests executed, the number passed, and the number failed.
5. IF one or more unit tests fail when the `test` script is executed for a Service, THEN THE Test_Runner SHALL exit with a non-zero status code.
6. IF the `test` script is executed for a Service and no unit test files are discovered, THEN THE Test_Runner SHALL exit with a non-zero status code and emit output indicating that no tests were found.
7. THE Test_Runner SHALL execute a Service's unit tests using the project's ESM module format while that Service retains its `"type": "module"` setting, without requiring any change to that setting.

### Requirement 2: Linting per service

**User Story:** As a developer, I want each service linted in CI, so that style and static-analysis issues are caught before deployment.

#### Acceptance Criteria

1. THE Linter SHALL be configured for the `mcp-server` Service, the `orchestrator` Service, and the `frontend` Service, where "configured" means the Service directory contains a Linter configuration file and the Linter is listed as a development dependency in that Service's `package.json`.
2. WHERE a Service has a configured Linter, THE Service SHALL expose a `lint` script in its `package.json` that runs the Linter over all `.js`, `.jsx`, and `.mjs` source files in that Service's directory, excluding `node_modules`, `dist`, and other build-output directories.
3. WHEN the `lint` script is executed and zero violations are found, THE Linter SHALL exit with status code 0 within 120 seconds.
4. IF the Linter detects one or more violations, THEN THE Linter SHALL exit with a non-zero status code and SHALL report, for each violation, the file path, the line number, the column number, and the rule identifier that was violated.
5. WHEN the CI_Stage runs for a commit, THE CI_Stage SHALL execute the `lint` script for each of the three Services (`mcp-server`, `orchestrator`, `frontend`).
6. IF the `lint` script for any Service exits with a non-zero status code during the CI_Stage, THEN THE CI_Stage SHALL fail with a non-zero status and SHALL prevent deployment, while reporting which Service produced violations.

### Requirement 3: Continuous integration on repository changes

**User Story:** As a maintainer, I want CI to run on pushes and pull requests, so that defects are detected before merge and deployment.

#### Acceptance Criteria

1. WHEN a commit is pushed to the `main` branch, THE Pipeline SHALL trigger the CI_Stage for that commit.
2. WHEN a pull request targeting the `main` branch is opened, updated with a new commit, or reopened, THE Pipeline SHALL trigger the CI_Stage for the pull request's head commit.
3. THE CI_Stage SHALL run the `lint` script and the `test` script for each of the three Services, producing six independent matrix jobs (two scripts per Service).
4. IF the `lint` script or the `test` script for any Service exits with a non-zero status code, THEN THE CI_Stage SHALL report a failed status for the triggering commit while allowing the remaining matrix jobs to run to completion.
5. WHEN all six matrix jobs complete with a zero status code, THE CI_Stage SHALL report a passed status for the triggering commit.
6. IF a matrix job does not complete within 15 minutes of starting, THEN THE CI_Stage SHALL terminate that job and report a failed status for the triggering commit.
7. IF dependency installation for a Service fails before its `lint` or `test` script executes, THEN THE CI_Stage SHALL report a failed status for the triggering commit with an error indication identifying the affected Service.

### Requirement 4: Docker image build verification for arm64

**User Story:** As a maintainer, I want CI to confirm every image builds for arm64, so that builds do not fail on the Oracle A1 target.

#### Acceptance Criteria

1. WHEN the CI_Stage runs, THE Image_Builder SHALL attempt to build each of the `mcp-server`, `orchestrator`, and `nginx` images targeting the `linux/arm64` platform.
2. WHEN all three images (`mcp-server`, `orchestrator`, and `nginx`) build successfully for the `linux/arm64` platform, THE CI_Stage SHALL report a passed status for the triggering commit.
3. IF any of the three images fails to build for the `linux/arm64` platform, THEN THE CI_Stage SHALL report a failed status for the triggering commit and SHALL include an indication identifying which image failed.
4. WHEN the `nginx` image is built, THE Image_Builder SHALL execute the multi-stage frontend build and produce the static widget assets `widget.js` and `widget.css`, each with a non-zero file size, within the final `nginx` image.
5. WHILE the CI_Stage is building an image for the `linux/arm64` platform, IF the build for that image does not complete within 1800 seconds, THEN THE CI_Stage SHALL terminate that build and report a failed status for the triggering commit.

### Requirement 5: Image publishing to a registry

**User Story:** As a maintainer, I want successfully built images published to a registry, so that the Production_Server can pull pre-built arm64 images instead of compiling on the VM.

#### Acceptance Criteria

1. WHEN a commit is pushed to the `main` branch and the CI_Stage completes with a passing status, THE Pipeline SHALL push the `mcp-server`, `orchestrator`, and `nginx` images to the Image_Registry.
2. WHEN the Pipeline pushes an image to the Image_Registry, THE Pipeline SHALL apply two tags to that image: the triggering commit's short SHA (the first 7 characters of the full 40-character commit SHA) and `latest`.
3. WHERE an image is pushed to the Image_Registry, THE Image_Builder SHALL include a `linux/arm64` platform variant for that image.
4. IF authentication to the Image_Registry fails, THEN THE Pipeline SHALL report a failed status, SHALL NOT push any image, and SHALL NOT proceed to the CD_Stage.
5. IF the push of any of the `mcp-server`, `orchestrator`, or `nginx` images to the Image_Registry does not complete successfully within 600 seconds, THEN THE Pipeline SHALL report a failed status, SHALL NOT proceed to the CD_Stage, and SHALL surface an error indication identifying which image failed to push.
6. IF a push attempt to the Image_Registry fails due to a transient network or registry error, THEN THE Pipeline SHALL retry that push up to 3 additional attempts before reporting a failed status.

### Requirement 6: Automated deployment to the production server

**User Story:** As a maintainer, I want the stack deployed to the Oracle A1 instance automatically after a successful build, so that I no longer perform manual deployment steps.

#### Acceptance Criteria

1. WHEN the CI_Stage passes and arm64 images are published for a commit on the `main` branch, THE CD_Stage SHALL deliver the Deployment_Artifact to the Production_Server.
2. WHEN the Deployment_Artifact is delivered to the Production_Server, THE CD_Stage SHALL pull the published arm64 images and start the stack using the committed compose configuration.
3. WHEN the stack is started, THE CD_Stage SHALL poll the Reverse_Proxy on host port 8080 at intervals not exceeding 10 seconds and SHALL report deployment success once the Reverse_Proxy returns a successful (non-error) HTTP response.
4. IF the Reverse_Proxy does not return a successful (non-error) HTTP response on host port 8080 within the 120-second verification timeout, THEN THE CD_Stage SHALL report a failed deployment status.
5. WHILE a deployment is in progress, THE CD_Stage SHALL connect to the Production_Server using key-based SSH authentication.
6. IF key-based SSH authentication to the Production_Server does not succeed, THEN THE CD_Stage SHALL abort the deployment without delivering the Deployment_Artifact and SHALL report a failed deployment status with an indication that authentication failed.
7. IF pulling the published arm64 images on the Production_Server does not succeed, THEN THE CD_Stage SHALL report a failed deployment status with an indication that the image pull failed and SHALL leave any previously running stack unchanged.
8. IF the deployment is reported as failed at any stage after a prior stack was running, THEN THE CD_Stage SHALL retain the previously running stack on the Production_Server.

### Requirement 7: Secrets management

**User Story:** As a maintainer, I want secrets stored encrypted and delivered securely to the VM, so that credentials are never committed to the repository or exposed in logs.

#### Acceptance Criteria

1. THE Secret_Store SHALL hold non-empty values for each of the following named secrets: `OPENPROJECT_API_TOKEN`, `ANTHROPIC_API_KEY`, `PROFILE_ARN`, `CLAUDE_MODEL`, and `OPENPROJECT_SECRET_KEY_BASE`.
2. WHEN the CD_Stage runs, THE CD_Stage SHALL generate the `.env` file on the Production_Server containing one entry per secret listed in criterion 1, with each entry's value taken from the corresponding value retrieved from the Secret_Store.
3. WHEN the CD_Stage generates the `.env` file on the Production_Server, THE CD_Stage SHALL set the file permissions so that the file is readable and writable only by its owner and inaccessible to group and other users.
4. WHILE the CD_Stage transmits Secret_Store values to the Production_Server, THE CD_Stage SHALL use an encrypted transport channel.
5. THE Pipeline SHALL replace every Secret_Store value with a masked placeholder in all Pipeline log output, so that no Secret_Store value appears in plain text in any log line.
6. THE Pipeline SHALL exclude the `.env` file and the Kiro_Token from the repository and from every committed Deployment_Artifact.
7. IF one or more values listed in criterion 1 are absent or empty in the Secret_Store, THEN THE CD_Stage SHALL terminate before generating the `.env` file, SHALL report a failed status, and SHALL identify each missing or empty value by its name.
8. IF generation of the `.env` file on the Production_Server fails, THEN THE CD_Stage SHALL report a failed status and SHALL NOT leave a partially written `.env` file in place.

### Requirement 8: Kiro auth token delivery and lifecycle

**User Story:** As a maintainer, I want the Kiro auth token delivered to the VM by the Pipeline and its expiry surfaced, so that deployment does not depend on a manual scp and token expiry is visible.

#### Acceptance Criteria

1. THE Secret_Store SHALL hold the contents of the Kiro_Token.
2. WHEN the CD_Stage runs, THE CD_Stage SHALL write the Kiro_Token to `~/.aws/sso/cache/kiro-auth-token.json` on the Production_Server with file permissions that grant read and write access to the owner only (0600) and no access to group or other users.
3. IF writing the Kiro_Token to the Production_Server fails, THEN THE CD_Stage SHALL halt deployment without restarting the `kiro-gateway` service, leave any previously written Kiro_Token unchanged, and report an error identifying the failed write.
4. WHEN the Kiro_Token is updated on the Production_Server, THE CD_Stage SHALL restart the `kiro-gateway` service so the new token takes effect.
5. IF the `kiro-gateway` service does not return to a running state within 60 seconds after the restart, THEN THE CD_Stage SHALL mark the deployment as failed and report an error identifying the `kiro-gateway` service.
6. IF the Kiro_Token stored in the Secret_Store has a refresh token expiry timestamp in the past, THEN THE Pipeline SHALL halt deployment before writing the Kiro_Token and report a warning, in the Pipeline run output, that identifies the expired Kiro_Token.
7. IF the Kiro_Token stored in the Secret_Store has a refresh token expiry timestamp 72 hours or less in the future, THEN THE Pipeline SHALL report a warning, in the Pipeline run output, that identifies the Kiro_Token and its expiry timestamp.
8. IF the Secret_Store does not contain a Kiro_Token when the CD_Stage runs, THEN THE CD_Stage SHALL halt deployment before writing to the Production_Server and report an error indicating the Kiro_Token is missing.

### Requirement 9: Production network hardening

**User Story:** As a maintainer, I want only the reverse proxy exposed publicly, so that internal services are not reachable from the host network in production.

#### Acceptance Criteria

1. WHILE the stack runs on the Production_Server, THE Reverse_Proxy SHALL be the only Service that publishes a host port, exposing exactly one public entry point.
2. WHILE the stack runs on the Production_Server, THE deployed compose configuration SHALL keep the `mcp-server` (port 3000), `orchestrator` (port 4000), and `kiro-gateway` (port 8000) reachable only over the internal Docker network, with zero host port bindings for these Services.
3. WHERE TLS termination is configured, THE Reverse_Proxy SHALL serve traffic over HTTPS on TCP port 443 as the public entry point.
4. IF a connection to the `mcp-server` (3000), `orchestrator` (4000), or `kiro-gateway` (8000) ports is attempted from the host network on the Production_Server, THEN THE connection SHALL be refused.
5. IF any Service other than the Reverse_Proxy declares a host port binding in the deployed compose configuration, THEN THE deployment validation SHALL flag the configuration as non-compliant and report each Service that violates the rule, without starting the stack.
6. WHERE TLS termination is configured, IF a client connects to the public entry point over plain HTTP on TCP port 80, THEN THE Reverse_Proxy SHALL redirect the client to the HTTPS entry point on TCP port 443.

### Requirement 10: Deployment reproducibility and documentation

**User Story:** As a maintainer, I want the automated deployment documented and reproducible, so that the process matches what runs in the Pipeline.

#### Acceptance Criteria

1. THE feature SHALL provide documentation that lists, for each required Secret_Store entry, its name and purpose, and that states the trigger conditions under which the CI_Stage and the CD_Stage each run.
2. WHEN a change to the Pipeline configuration alters the Secret_Store entries, the CI_Stage trigger conditions, the CD_Stage trigger conditions, or the set of first-party images, THE documentation SHALL be updated within the same change so that it matches the current process, with no entry, trigger, or image present in the Pipeline configuration that is absent from the documentation and none present in the documentation that is absent from the Pipeline configuration.
3. THE deployed stack SHALL build every first-party image from a Dockerfile pinned to a specific base image version and from a committed `package-lock.json`, such that two builds from the same commit produce images whose contents differ only by environment variable values.
4. IF the CD_Stage runs against a commit in which any first-party image references a base image without a pinned version or lacks a committed `package-lock.json`, THEN THE CD_Stage SHALL stop before deployment and report a failure indicating which image is not reproducibly pinned, leaving any previously deployed stack unchanged.
5. THE documentation SHALL enable a maintainer to reproduce the deployment using only the documented Secret_Store entries and the committed Pipeline configuration, with no step that depends on undocumented manual configuration.
