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

1. THE Test_Runner SHALL be configured for the `mcp-server` Service, the `orchestrator` Service, and the `frontend` Service.
2. WHERE a Service has a configured Test_Runner, THE Service SHALL expose a `test` script that runs the Test_Runner in single-run (non-watch) mode.
3. WHEN the `test` script is executed for a Service, THE Test_Runner SHALL execute that Service's unit tests and exit with a zero status code when all tests pass.
4. IF one or more unit tests fail, THEN THE Test_Runner SHALL exit with a non-zero status code.
5. THE Test_Runner SHALL support the project's ESM module format without requiring changes to a Service's `"type": "module"` setting.

### Requirement 2: Linting per service

**User Story:** As a developer, I want each service linted in CI, so that style and static-analysis issues are caught before deployment.

#### Acceptance Criteria

1. THE Linter SHALL be configured for the `mcp-server` Service, the `orchestrator` Service, and the `frontend` Service.
2. WHERE a Service has a configured Linter, THE Service SHALL expose a `lint` script that runs the Linter over that Service's source files.
3. WHEN the `lint` script is executed and no violations are found, THE Linter SHALL exit with a zero status code.
4. IF the Linter detects one or more violations, THEN THE Linter SHALL exit with a non-zero status code and report each violation with its file path and line number.

### Requirement 3: Continuous integration on repository changes

**User Story:** As a maintainer, I want CI to run on pushes and pull requests, so that defects are detected before merge and deployment.

#### Acceptance Criteria

1. WHEN a commit is pushed to the `main` branch, THE Pipeline SHALL trigger the CI_Stage.
2. WHEN a pull request targeting the `main` branch is opened or updated, THE Pipeline SHALL trigger the CI_Stage.
3. THE CI_Stage SHALL run the `lint` script and the `test` script for each of the three Services as separate matrix jobs.
4. IF the `lint` script or the `test` script for any Service exits with a non-zero status code, THEN THE CI_Stage SHALL report a failed status for the triggering commit.
5. WHEN every matrix job completes with a zero status code, THE CI_Stage SHALL report a passed status for the triggering commit.

### Requirement 4: Docker image build verification for arm64

**User Story:** As a maintainer, I want CI to confirm every image builds for arm64, so that builds do not fail on the Oracle A1 target.

#### Acceptance Criteria

1. THE Image_Builder SHALL build the `mcp-server`, `orchestrator`, and `nginx` images targeting the `linux/arm64` platform.
2. WHEN the CI_Stage runs, THE Image_Builder SHALL attempt to build each Docker image for the `linux/arm64` platform.
3. IF any image fails to build for the `linux/arm64` platform, THEN THE CI_Stage SHALL report a failed status for the triggering commit.
4. WHEN the `nginx` image is built, THE Image_Builder SHALL complete the multi-stage frontend build and produce the static widget assets within the final image.

### Requirement 5: Image publishing to a registry

**User Story:** As a maintainer, I want successfully built images published to a registry, so that the Production_Server can pull pre-built arm64 images instead of compiling on the VM.

#### Acceptance Criteria

1. WHEN a commit is pushed to the `main` branch and the CI_Stage passes, THE Pipeline SHALL push the `mcp-server`, `orchestrator`, and `nginx` images to the Image_Registry.
2. THE Pipeline SHALL tag each pushed image with the triggering commit's short SHA and with `latest`.
3. WHERE an image is pushed to the Image_Registry, THE Image_Builder SHALL include a `linux/arm64` variant for that image.
4. IF authentication to the Image_Registry fails, THEN THE Pipeline SHALL report a failed status and SHALL NOT proceed to the CD_Stage.

### Requirement 6: Automated deployment to the production server

**User Story:** As a maintainer, I want the stack deployed to the Oracle A1 instance automatically after a successful build, so that I no longer perform manual deployment steps.

#### Acceptance Criteria

1. WHEN the CI_Stage passes and images are published for a `main` branch commit, THE CD_Stage SHALL deliver the Deployment_Artifact to the Production_Server.
2. WHEN the Deployment_Artifact is delivered, THE CD_Stage SHALL pull the published arm64 images on the Production_Server and start the stack using the committed compose configuration.
3. WHEN the stack is started, THE CD_Stage SHALL verify that the Reverse_Proxy responds successfully on host port 8080 before reporting deployment success.
4. IF the post-deployment verification does not succeed within a defined timeout of 120 seconds, THEN THE CD_Stage SHALL report a failed deployment status.
5. WHILE a deployment is in progress, THE CD_Stage SHALL connect to the Production_Server using key-based SSH authentication.

### Requirement 7: Secrets management

**User Story:** As a maintainer, I want secrets stored encrypted and delivered securely to the VM, so that credentials are never committed to the repository or exposed in logs.

#### Acceptance Criteria

1. THE Secret_Store SHALL hold the values for `OPENPROJECT_API_TOKEN`, `ANTHROPIC_API_KEY`, `PROFILE_ARN`, `CLAUDE_MODEL`, and `OPENPROJECT_SECRET_KEY_BASE`.
2. WHEN the CD_Stage runs, THE CD_Stage SHALL generate the `.env` file on the Production_Server from values retrieved from the Secret_Store.
3. THE Pipeline SHALL mask Secret_Store values in all Pipeline log output.
4. THE Pipeline SHALL exclude the `.env` file and the Kiro_Token from the repository and from any committed Deployment_Artifact.
5. IF a required value is absent from the Secret_Store, THEN THE CD_Stage SHALL report a failed status and SHALL identify the missing value by name.

### Requirement 8: Kiro auth token delivery and lifecycle

**User Story:** As a maintainer, I want the Kiro auth token delivered to the VM by the Pipeline and its expiry surfaced, so that deployment does not depend on a manual scp and token expiry is visible.

#### Acceptance Criteria

1. THE Secret_Store SHALL hold the contents of the Kiro_Token.
2. WHEN the CD_Stage runs, THE CD_Stage SHALL write the Kiro_Token to `~/.aws/sso/cache/kiro-auth-token.json` on the Production_Server with file permissions readable only by the owner.
3. WHEN the Kiro_Token is updated on the Production_Server, THE CD_Stage SHALL restart the `kiro-gateway` service so the new token takes effect.
4. IF the Kiro_Token stored in the Secret_Store has a refresh token expiry timestamp in the past, THEN THE Pipeline SHALL report a warning that identifies the expired Kiro_Token before deployment.

### Requirement 9: Production network hardening

**User Story:** As a maintainer, I want only the reverse proxy exposed publicly, so that internal services are not reachable from the host network in production.

#### Acceptance Criteria

1. WHILE the stack runs on the Production_Server, THE Reverse_Proxy SHALL be the only Service that binds a host port.
2. THE deployed compose configuration SHALL keep the `mcp-server` (3000), `orchestrator` (4000), and `kiro-gateway` (8000) ports internal to the Docker network without host port bindings.
3. WHERE TLS termination is configured, THE Reverse_Proxy SHALL serve traffic over HTTPS on the public entry point.

### Requirement 10: Deployment reproducibility and documentation

**User Story:** As a maintainer, I want the automated deployment documented and reproducible, so that the process matches what runs in the Pipeline.

#### Acceptance Criteria

1. THE feature SHALL provide documentation describing the required Secret_Store entries and the trigger conditions for the CI_Stage and the CD_Stage.
2. WHEN the Pipeline configuration changes the deployment process, THE documentation SHALL be updated in the same change to reflect the current process.
3. THE deployed stack SHALL build every first-party image from a pinned Dockerfile and committed `package-lock.json`, so that the only difference between environments is environment variable values.
