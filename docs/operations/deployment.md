# Deployment and Rollback

This document defines the staging and production deployment procedure, deployment verification and rollback principles.

For the operational overview, see `overview.md`.

For Git and release progression, see `../git-workflow.md`.

For testing and smoke-test requirements, see `../testing/overview.md`.

For security rules, see `../security/overview.md`.

Root `AGENTS.md` is authoritative for deployment control gates and explicit user commands.

## Purpose

Deployment is a controlled transition of a specific repository version into staging or production.

A deployment procedure must provide:

- traceability to the deployed version;
- reproducible deployment from repository state;
- appropriate database migration handling;
- post-deployment verification;
- a defined recovery path when deployment fails.

Operational commands documented here must correspond to the actual implemented infrastructure.

Do not invent deployment or rollback commands before they exist and have been verified.

## Deployment model

The normal progression is:

    approved repository version
        ↓
    required CI
        ↓
    main
        ↓
    staging deployment
        ↓
    staging verification
        ↓
    STAGING OK
        ↓
    wait
        ↓
    DEPLOY PRODUCTION
        ↓
    production deployment
        ↓
    production verification

`STAGING OK` and `DEPLOY PRODUCTION` are separate control gates.

Successful staging verification does not itself authorize production deployment.

The exact Codex workflow is defined in root `AGENTS.md`.

## Version identity

Every staging and production deployment must be traceable to a concrete repository version.

The version verified on staging must be identifiable by commit hash or an equivalent immutable deployment identifier derived from repository state.

`STAGING OK` applies only to the version that was actually verified.

If code changes after staging approval, the changed version requires the applicable workflow and staging verification again.

Do not deploy an ambiguous or locally modified version that cannot be traced back to the repository.

## Container image delivery

The `web/` application has a production Docker image defined by `web/Dockerfile`.

Container delivery decisions currently in effect:

- the `web` image is built in GitHub Actions CI;
- the image is stored in GitHub Container Registry;
- the image is built once for a repository commit;
- STAGING and PRODUCTION use the same immutable image digest;
- STAGING and PRODUCTION run as separate Docker Compose projects on the VDS.

The current GHCR image name is:

```text
ghcr.io/mishakozarev/tuttoseriea/web
```

CI tags the image as:

```text
sha-<commit-sha>
```

Deployment must use the immutable digest for the image produced by CI, not rebuild
a different image separately for each environment.

The current repository workflow builds and smoke-checks the image for Pull Requests.
On `push` to `main`, it publishes the smoke-checked image to GHCR. This is artifact
delivery only; it does not deploy to STAGING or PRODUCTION.

## Staging deployment

Staging receives the version produced by the approved Git/CI workflow.

Deployment should use the project's production-like containerized architecture rather than a separate ad-hoc application model.

The staging deployment process may include, as required by the implemented infrastructure:

- obtaining the approved GHCR image digest;
- preparing server-side environment configuration;
- pulling required container images by digest;
- applying required Drizzle migrations;
- starting/updating application services;
- verifying service health;
- running relevant smoke checks.

The exact staging deployment mechanism and commands must be added here after they exist.

## Staging verification

A successful deployment command is not sufficient evidence that staging is healthy.

After deployment, verify the behavior relevant to the change.

The verification may include:

- public application availability;
- expected HTTP responses;
- container/service health;
- database connectivity through the application;
- migration state;
- Next.js ↔ FastAPI communication;
- authentication/authorization behavior where affected;
- relevant background job behavior;
- relevant SEO behavior;
- critical user flows affected by the change.

The exact manual scenario depends on the deployed change.

After staging deployment and automated checks, Codex provides the manual staging verification scenario and waits for the explicit gate defined in root `AGENTS.md`.

## Staging failure

If staging verification fails, the user reports the failure according to root `AGENTS.md`.

Do not continue to production.

Determine whether the problem originates from:

- application code;
- migration;
- configuration;
- container/runtime behavior;
- service communication;
- infrastructure;
- another deployment-specific cause.

Tracked application/configuration changes must be corrected through the repository workflow.

Do not make an undocumented direct staging-server code patch and then treat that modified environment as an approved release.

The corrected version must pass the applicable workflow again.

## Production authorization

Production deployment is never implied by:

- successful LOCAL verification;
- successful CI;
- merge to `main`;
- successful staging deployment;
- `STAGING OK`.

Production deployment begins only after the explicit:

`DEPLOY PRODUCTION`

command defined in root `AGENTS.md`.

Codex must not reinterpret other positive user wording as production authorization.

## Production deployment

Production must deploy the specific version approved through staging.

Before deployment, verify that the intended production version corresponds to the version covered by `STAGING OK`.

The production deployment procedure may include, according to the implemented infrastructure:

- obtaining the STAGING-approved GHCR image digest;
- validating required production configuration;
- pulling required container images by digest;
- applying required Drizzle migrations;
- updating application services;
- verifying service/container health;
- executing relevant production smoke checks.

The exact commands must be added only after the real deployment implementation exists.

## Database migrations

Drizzle remains the single migration authority in staging and production.

Deployment must not introduce a separate production migration mechanism.

A release requiring a schema change must include the corresponding migration.

Migration execution must be ordered so that application/database compatibility is preserved during the deployment strategy actually used.

Potentially destructive migrations require explicit risk assessment and user authorization appropriate to their impact.

Do not perform destructive schema/data operations merely because they are technically part of a deployment script.

## Production verification

After production deployment, verify that the deployed system is operational.

Verification should be proportional to the change and may include:

- public application availability;
- expected HTTP status;
- service/container health;
- database-backed read paths;
- Next.js ↔ FastAPI communication;
- authentication where affected;
- relevant critical user flow;
- relevant SEO behavior;
- relevant job/background processing behavior.

Production smoke verification must avoid uncontrolled destructive or expensive side effects.

A deployment is not considered operationally successful solely because the deployment process returned exit code `0`.

## Health checks

Health checks should provide enough information to determine whether required services can safely serve their intended responsibility.

Potential checks may include:

- `web/` process/application health;
- `ai-service/` process/application health;
- required database connectivity;
- required internal service communication.

Do not expose sensitive internal diagnostic information through public health endpoints.

FastAPI remains internal-only in staging and production.

Exact health endpoints, response contracts and container health-check configuration remain undefined until implemented.

When implemented, document the real endpoints and expected responses here.

## Deployment failure

If production deployment or post-deployment verification fails, stop uncontrolled progression.

Do not repeatedly redeploy without understanding whether the operation is safe and what state the previous attempt left behind.

Determine:

- which deployment step failed;
- whether migrations executed;
- whether services changed version;
- whether the previous version remains operational;
- whether rollback is safe;
- whether a forward fix is safer than rollback.

Follow the production error workflow defined in root `AGENTS.md`.

## Rollback principle

Production must have a defined recovery path once the real deployment architecture exists.

Rollback should restore the last known-good application version when that is the safest recovery action.

However, application rollback and database rollback are not automatically equivalent.

A database migration may make an older application version incompatible with the current schema.

Therefore, never assume that reverting application containers alone is safe after every migration.

Before rollback, consider:

- application/database compatibility;
- whether the migration was additive or destructive;
- whether production data changed after deployment;
- whether reverting schema/data could cause data loss;
- whether a forward fix is safer.

## Database rollback

Do not automatically reverse production migrations merely because an application deployment is rolled back.

Database rollback can be more destructive than leaving a compatible migrated schema in place.

The concrete recovery strategy must be determined by the migration involved.

Destructive data/schema reversal requires explicit user approval.

When practical, prefer deployment-compatible migration design that keeps the previous application version usable during the relevant deployment window.

The exact migration/rollback strategy may evolve when the production deployment model is implemented.

## Direct server changes

The repository and deployment configuration are the source of truth for deployed application code.

Do not use direct edits on staging or production servers as the normal deployment or recovery mechanism.

If an emergency manual operational action becomes necessary:

- make the scope explicit;
- obtain the required authorization;
- preserve traceability;
- reconcile any persistent configuration/code change back into the repository where appropriate.

Do not allow an undocumented server modification to become permanent production state.

## Secrets and configuration

Production secrets remain outside Git.

Deployment tooling must not:

- print secrets to logs;
- embed secrets into client bundles;
- commit generated secret files;
- expose service-to-service credentials publicly.

Configuration failures must be fixed through the appropriate configuration mechanism rather than by hardcoding credentials into application code.

Detailed rules are defined in `../security/overview.md`.

## Deployment observability

Deployment should produce enough diagnostic information to determine:

- version being deployed;
- deployment stage;
- success/failure of major steps;
- migration outcome;
- service startup/health outcome;
- post-deployment verification outcome.

Do not expose secrets or unnecessary sensitive information in deployment logs.

General monitoring and logging rules are documented in `monitoring.md`.

## Keeping this runbook current

Once concrete deployment tooling exists, this document becomes an operational runbook.

It must then contain the actual:

- staging deployment procedure;
- production deployment procedure;
- required commands;
- expected command outcomes;
- health endpoints;
- verification steps;
- rollback procedure.

Update this document in the same PR when those operational mechanics change.

Remove obsolete procedures rather than leaving multiple ambiguous alternatives.

## Open Questions

The following details remain open until the real deployment infrastructure is implemented and verified:

- exact staging deployment trigger and commands;
- exact production deployment trigger and commands;
- exact migration execution point;
- exact health-check endpoints and contracts;
- exact automated smoke-test implementation;
- exact last-known-good version tracking mechanism;
- exact application rollback commands;
- concrete database migration compatibility strategy;
- concrete database backup/recovery procedure.

Do not fill these sections with hypothetical commands. Resolve them from the implemented and tested infrastructure.
