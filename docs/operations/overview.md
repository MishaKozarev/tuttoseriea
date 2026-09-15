# Operations Overview

This document is the stable entry point for production operations documentation.

For overall architecture, see `../architecture/overview.md`.

For development environment and production-like verification, see `../development/overview.md`.

For testing and smoke-test principles, see `../testing/overview.md`.

For Git and release progression, see `../git-workflow.md`.

For security rules, see `../security/overview.md`.

## Purpose

Operations documentation describes how the implemented system is deployed, verified and operated outside normal LOCAL development.

Operational procedures must reflect the actual infrastructure and deployment tooling.

Do not document hypothetical commands, infrastructure or recovery procedures as though they already exist.

## Environment model

The project uses three operational stages:

- LOCAL;
- staging;
- production.

LOCAL is the development environment.

Staging is used to verify the version produced by the approved Git/CI workflow before production.

Production serves the live application.

Progression between these environments is controlled by the explicit workflow gates defined in root `AGENTS.md`.

## Production architecture

The production architecture is based on:

- VDS hosting;
- Docker;
- GitHub Actions;
- Cloudflare;
- PostgreSQL + pgvector;
- containerized `web/`;
- containerized `ai-service/`.

FastAPI remains internal-only in staging and production and communicates with `web/` over the internal service/network boundary.

The `web` container image is built in GitHub Actions CI, stored in GHCR and
promoted to STAGING and PRODUCTION by immutable digest. STAGING and PRODUCTION
use separate Docker Compose projects on the VDS.

The VDS deployment contract is documented in `deployment.md`. It uses SSH to the
restricted `deploy` user, environment-specific forced commands, restricted `sudo`
and root-owned deployment scripts that operate the corresponding Docker Compose
project.

Repository-side GitHub Actions deployment workflows must use that documented
contract. The STAGING workflow is implemented by
`.github/workflows/deploy-staging.yml`. It deploys a validated immutable GHCR
image digest to the documented STAGING VDS entrypoint and verifies
`https://staging.tuttoseriea.com/` after deployment.

## Operational responsibilities

Operational documentation is divided into two primary areas.

### Deployment and recovery

`deployment.md` defines operational procedures related to:

- staging deployment;
- production deployment;
- deployment verification;
- health checks;
- rollback;
- production deployment failures.

### Monitoring and observability

`monitoring.md` defines operational rules related to:

- application/service health;
- structured logs;
- operational diagnostics;
- failure visibility;
- monitoring introduced as the project evolves.

These documents may be split further later if a real operational responsibility becomes large enough to justify a dedicated document.

## Deployment control

Operational capability does not authorize deployment.

Codex must follow the explicit control gates in root `AGENTS.md`.

In particular:

- successful CI does not authorize production;
- merge to `main` does not authorize production;
- successful staging deployment does not authorize production;
- `STAGING OK` approves the verified staging version but does not deploy it;
- production deployment requires the separate explicit `DEPLOY PRODUCTION` command.

Deployment mechanics are documented in `deployment.md`.

## Staging

Staging should represent the production deployment model closely enough to reveal deployment/runtime problems before production.

Staging verification may include:

- application availability;
- container/service startup;
- database migration state;
- Next.js ↔ FastAPI communication;
- critical application behavior;
- relevant smoke checks.

The exact verification scenario depends on the change.

Staging must not be manually modified in a way that creates an undocumented difference from the repository/deployment process.

If a staging problem requires a code or tracked configuration change, fix it through the repository workflow and deploy the corrected version.

## Production

Production changes must be traceable to the repository version that was approved through the workflow.

Do not use direct server edits as the normal production change mechanism.

Production configuration and secrets must remain outside Git according to the security policy.

A production deployment should be followed by verification appropriate to the change.

Successful deployment execution alone does not prove that the application is healthy.

Detailed deployment and rollback behavior is defined in `deployment.md`.

## Database operations

Production schema changes use the same Drizzle migration authority defined by the project architecture.

Do not introduce a separate production-only migration mechanism.

Database migrations must be part of the corresponding application change.

Potentially destructive or irreversible database operations require explicit authorization and appropriate recovery consideration.

Detailed database architecture is documented in `../architecture/database.md`.

## Background jobs

Scheduled and background processing must remain observable in production.

A job failure must not disappear silently.

Production job execution follows the same:

- idempotency;
- concurrency;
- retry;
- persisted-state;

principles defined in `../jobs/overview.md`.

Bulk execution remains separately controlled even when the required job implementation is already deployed.

## External providers

Production must tolerate temporary external provider failure according to the relevant integration architecture.

For imported football data, temporary provider failure should normally affect freshness rather than availability of already persisted public data.

Operational diagnostics should make external-provider failures distinguishable from internal application failures where practical.

Detailed provider behavior is documented in `../architecture/integrations.md`.

## Logs and diagnostics

Production diagnostics use structured logging.

Logs must support correlation of relevant operations through identifiers such as:

- `requestId`;
- job identity;
- operation/context identifiers where appropriate.

Operational visibility must not violate security rules.

Do not expose secrets or unnecessary sensitive data merely to make production debugging easier.

Detailed security requirements are documented in `../security/overview.md`.

Monitoring-specific rules are documented in `monitoring.md`.

## Production failures

A production failure must be treated as an operational incident at the production stage.

Do not attempt uncontrolled repeated deployments or direct server modifications merely to make the system work.

Depending on the failure, the appropriate response may be:

- diagnose and correct the deployment;
- rollback to the last known-good version;
- fix through the repository workflow and deploy a corrected version;
- take another explicitly approved recovery action.

The concrete rollback and failure procedure is documented in `deployment.md`.

## Documentation accuracy

Operational documentation is useful only when it matches reality.

When deployment infrastructure, health checks, server topology or operational procedures change, update the relevant documentation in the same PR.

Do not keep obsolete commands as historical alternatives inside the active operational procedure.

If historical operational information becomes useful, preserve it separately rather than making the current runbook ambiguous.

## Growth principle

Keep `overview.md` as the stable operational entry point.

Add operational detail documents only when a concrete responsibility requires them.

For example, future growth may justify focused documents for:

- backups/recovery;
- incident response;
- alerting;
- infrastructure maintenance.

Do not create these areas before the corresponding operational responsibility actually exists.

## Open Questions

The following operational details remain open until the infrastructure is implemented and verified:

- repository-side GitHub Actions production deployment workflow/mechanics;
- exact health-check endpoints;
- exact rollback procedure;
- release-state/version tracking, including `current-release`, `verified-release`
  and `previous-release`;
- database backup/recovery strategy;
- monitoring and alerting stack;
- log storage/retention strategy;
- operational incident-response procedure.

These questions must be resolved from the real infrastructure and operational requirements rather than documented as hypothetical procedures.
