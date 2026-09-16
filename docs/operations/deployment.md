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
    Deploy Staging
        ↓
    STAGING HTTP smoke
        ↓
    manual STAGING verification
        ↓
    STAGING OK
        ↓
    Verify Staging
        ↓
    STAGING verified-release
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

## VDS deployment contract

The VDS deployment infrastructure already exists outside this repository. This
section records the contract that repository-side deployment automation must use.
Changing the server setup is a separate infrastructure task.

There is one VDS. STAGING and PRODUCTION are logically isolated on that host.

SSH deployment access uses:

- SSH port: `56777`;
- user: `deploy`;
- separate SSH credentials for STAGING and PRODUCTION.

The `deploy` user is intentionally restricted:

- it is not a member of the `docker` group;
- it has no direct access to the Docker socket;
- it has no arbitrary `sudo`;
- SSH access is restricted by environment-specific forced commands;
- forced commands invoke the allowed root-owned deployment mechanism through
  restricted `sudo`.

Environment-specific server entrypoints:

| Environment | Forced command | Root-owned deployment script |
| --- | --- | --- |
| STAGING | `/usr/local/sbin/tuttoseriea-ssh-staging` | `/usr/local/sbin/tuttoseriea-deploy-staging` |
| PRODUCTION | `/usr/local/sbin/tuttoseriea-ssh-production` | `/usr/local/sbin/tuttoseriea-deploy-production` |

Additional root-owned PRODUCTION scripts implemented on the VDS:

- `/usr/local/sbin/tuttoseriea-verify-production`;
- `/usr/local/sbin/tuttoseriea-rollback-production`.

The SSH-exposed deployment command contract is:

```text
deploy <GIT_SHA> <IMAGE_DIGEST>
```

`GIT_SHA` identifies the repository version being deployed. `IMAGE_DIGEST`
identifies the immutable GHCR image digest to run.

The root-owned deployment script is responsible for applying the requested
version to the corresponding environment through Docker Compose and must use the
provided immutable image digest rather than rebuilding an image on the VDS.

The VDS root context already has authentication for pulling from GHCR.
Repository-side automation must not commit GHCR credentials or pass credentials
through logs.

Environment-specific Compose contract:

| Environment | Compose project | Config directory | Compose file | Runtime env file | Host port |
| --- | --- | --- | --- | --- | --- |
| STAGING | `tuttoseriea-staging` | `/srv/tuttoseriea/staging/config` | `/srv/tuttoseriea/staging/config/compose.yaml` | `/srv/tuttoseriea/staging/config/runtime.env` | `127.0.0.1:8898` |
| PRODUCTION | `tuttoseriea-production` | `/srv/tuttoseriea/production/config` | `/srv/tuttoseriea/production/config/compose.yaml` | `/srv/tuttoseriea/production/config/runtime.env` | `127.0.0.1:8899` |

STAGING and PRODUCTION must use the same image digest after `STAGING OK`.
Production deployment is still authorized only by the separate `DEPLOY PRODUCTION`
gate defined in root `AGENTS.md`.

Release-state/version tracking is implemented on the VDS.

Release-state records use the format:

```text
<GIT_SHA> <IMAGE_DIGEST>
```

STAGING state:

- `current-release` records the version currently applied to STAGING;
- `verified-release` records the STAGING version that has passed the required
  verification for promotion.

PRODUCTION state:

- `current-release` records the version currently applied to PRODUCTION;
- `verified-release` records the last production version that passed
  post-deployment verification;
- `previous-release` records the previous known-good production version that is
  allowed as the rollback target.

Before the first PRODUCTION deployment, PRODUCTION `current-release`,
`verified-release` and `previous-release` may be absent. In that state,
application rollback is unavailable because there is no trusted previous release
yet.

State writes are atomic on the VDS. The server-side implementation writes a
temporary file in the target state directory, syncs it, renames it into place and
syncs the directory.

Production deploy, verify, rollback and read-only release-state operations are
serialized by the VDS production lock.

Additional STAGING SSH command contract:

```text
verify <GIT_SHA> <IMAGE_DIGEST>
```

`verify` marks the current STAGING version as verified only after manual
STAGING verification has passed and the explicit `STAGING OK` gate has been
given.

Additional PRODUCTION SSH command contract:

```text
verify <GIT_SHA> <IMAGE_DIGEST>
rollback <GIT_SHA> <IMAGE_DIGEST>
previous-release
```

`verify` marks the current production version as verified only after
post-deployment checks have passed.

`rollback` keeps the existing safety boundary: the VDS independently verifies
that the requested pair exactly matches trusted PRODUCTION `previous-release`.

`previous-release` is a strictly limited read-only operation. It accepts no
arguments, reads only trusted PRODUCTION `previous-release`, validates the record
format before output and returns only:

```text
<GIT_SHA> <IMAGE_DIGEST>
```

If PRODUCTION `previous-release` is absent, `previous-release` exits non-zero.
The `deploy` user still has no direct state-file read access, Docker socket
access, arbitrary `sudo` or shell access.

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

The VDS-side deployment command contract and server-side entrypoints are defined
in the VDS deployment contract above.

Repository-side STAGING deployment is implemented by:

```text
.github/workflows/deploy-staging.yml
```

The workflow is manually triggered with `workflow_dispatch` and must run from
`main`.

Required inputs:

- `git_sha` - a full 40-character commit SHA;
- `image_digest` - an immutable digest in `sha256:<64-hex>` format.

The workflow accepts `git_sha` only when that commit is an ancestor of the current
`origin/main`. The commit does not have to equal the current head of `main`; this
allows redeploying an earlier version that genuinely passed through `main`.
The checkout/fetch history must be complete enough for this ancestry check to be
reliable.

Before connecting to the VDS, the workflow verifies that:

```text
ghcr.io/mishakozarev/tuttoseriea/web:sha-<git_sha>
```

resolves to the exact `image_digest` passed as input.

Only after the `git_sha` and image tag-to-digest checks succeed does the workflow
invoke the documented VDS command contract over SSH:

```text
deploy <GIT_SHA> <IMAGE_DIGEST>
```

Required GitHub Actions environment:

```text
staging
```

Required `staging` environment secrets:

- `STAGING_SSH_HOST` - SSH host for the VDS;
- `STAGING_SSH_PRIVATE_KEY` - STAGING-specific private key for the `deploy` user;
- `STAGING_SSH_KNOWN_HOSTS` - pinned SSH `known_hosts` entry for the VDS SSH
  endpoint on port `56777`.

The workflow uses the fixed VDS contract values documented above:

- SSH user: `deploy`;
- SSH port: `56777`;
- staging URL: `https://staging.tuttoseriea.com/`.

After the VDS deployment command succeeds, the workflow verifies that
`https://staging.tuttoseriea.com/` is reachable over HTTP and that the response
body is non-empty. This is the current deployed-environment STAGING smoke check.
It does not define a dedicated health-check endpoint. The STAGING deployment
workflow does not update STAGING `verified-release`.

The workflow writes a release summary containing the deployed Git SHA, image tag,
image digest, staging URL, VDS command identity and smoke result.

Repository-side STAGING verification is implemented by:

```text
.github/workflows/verify-staging.yml
```

The workflow is manually triggered with `workflow_dispatch` after the user has
completed manual STAGING verification and given the explicit `STAGING OK` gate.
It must run from `main`.

Required inputs:

- `git_sha` - the full 40-character commit SHA approved through `STAGING OK`;
- `image_digest` - the immutable GHCR digest in `sha256:<64-hex>` format.

The workflow validates that:

- `git_sha` is an ancestor of current `origin/main`;
- the GHCR tag
  `ghcr.io/mishakozarev/tuttoseriea/web:sha-<git_sha>` resolves to the exact
  `image_digest` input.

Only after repository-side validation succeeds does the workflow invoke the VDS
STAGING command:

```text
verify <GIT_SHA> <IMAGE_DIGEST>
```

This records STAGING `verified-release` on the VDS. Production promotion is
allowed only for the pair recorded as trusted STAGING `verified-release`.

For PRODUCTION promotion, the VDS-side production deployment script checks the
requested pair against trusted STAGING `verified-release`.

## Bootstrap 1.10 E2E verification record

Bootstrap 1.10 verified the implemented repository and deployment chain
end-to-end. This section records that bootstrap verification result; it is not a
rolling current-release log.

Release B:

```text
244b758e3d0edc03b639832b13090145b75aab7f sha256:04e25ec6bbcc5f5b00e2fed034ccd6256a7d4d8c11a361b70d782dfaf3a608bf
```

Previous production release A:

```text
764b0c183b3ffbce5405dee91dfcd96459454aff sha256:0ab14a226dbe79688d518687fe995ce26b83c70d5fcc21a86444f9b026cc592d
```

The verified chain was:

- STAGING deploy of release B succeeded;
- STAGING HTTP smoke succeeded;
- manual STAGING verification succeeded and `STAGING OK` was given;
- `Verify Staging` recorded release B as STAGING `verified-release`;
- PRODUCTION deploy of release B succeeded;
- PRODUCTION HTTP smoke and VDS `verify` succeeded;
- PRODUCTION rollback B -> A succeeded through trusted VDS `previous-release`;
- rollback HTTP smoke and VDS `verify` succeeded;
- final PRODUCTION deploy A -> B succeeded;
- final PRODUCTION HTTP smoke and VDS `verify` succeeded;
- final manual production verification confirmed `Bootstrap E2E marker` on
  `https://tuttoseriea.com/`.

Final production release-state after Bootstrap 1.10:

```text
current-release  = 244b758e3d0edc03b639832b13090145b75aab7f sha256:04e25ec6bbcc5f5b00e2fed034ccd6256a7d4d8c11a361b70d782dfaf3a608bf
verified-release = 244b758e3d0edc03b639832b13090145b75aab7f sha256:04e25ec6bbcc5f5b00e2fed034ccd6256a7d4d8c11a361b70d782dfaf3a608bf
previous-release = 764b0c183b3ffbce5405dee91dfcd96459454aff sha256:0ab14a226dbe79688d518687fe995ce26b83c70d5fcc21a86444f9b026cc592d
```

Example first-run command:

```bash
gh workflow run deploy-staging.yml --ref main \
  -f git_sha=<main-ancestor-commit-sha> \
  -f image_digest=<sha256-image-digest>
```

Example STAGING verification command after manual `STAGING OK`:

```bash
gh workflow run verify-staging.yml --ref main \
  -f git_sha=<staging-ok-commit-sha> \
  -f image_digest=<sha256-image-digest>
```

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

The VDS-side deployment command contract and server-side entrypoints are defined
in the VDS deployment contract above.

Repository-side PRODUCTION deployment is implemented by:

```text
.github/workflows/deploy-production.yml
```

The workflow is manually triggered with `workflow_dispatch` and must run from
`main`.

Required inputs:

- `git_sha` - the full 40-character commit SHA approved through STAGING;
- `image_digest` - the immutable GHCR digest in `sha256:<64-hex>` format.

The production workflow validates that:

- `git_sha` is an ancestor of current `origin/main`;
- the GHCR tag
  `ghcr.io/mishakozarev/tuttoseriea/web:sha-<git_sha>` resolves to the exact
  `image_digest` input.

Only after repository-side validation succeeds does the workflow invoke the VDS
production command:

```text
deploy <GIT_SHA> <IMAGE_DIGEST>
```

The VDS independently verifies that the requested pair matches trusted STAGING
`verified-release` before applying it to PRODUCTION.

Required GitHub Actions environment:

```text
production
```

Required `production` environment secrets:

- `PRODUCTION_SSH_HOST` - SSH host for the VDS;
- `PRODUCTION_SSH_PRIVATE_KEY` - PRODUCTION-specific private key for the
  `deploy` user;
- `PRODUCTION_SSH_KNOWN_HOSTS` - pinned SSH `known_hosts` entry for the VDS SSH
  endpoint on port `56777`.

The workflow uses the fixed VDS contract values documented above:

- SSH user: `deploy`;
- SSH port: `56777`;
- production URL: `https://tuttoseriea.com/`.

After the VDS deployment command succeeds, the workflow verifies that
`https://tuttoseriea.com/` is reachable over HTTP and that the response body is
non-empty. This is the current deployed-environment PRODUCTION smoke check. It
does not define a dedicated health-check endpoint.

Only after the production HTTP smoke check succeeds does the workflow invoke:

```text
verify <GIT_SHA> <IMAGE_DIGEST>
```

This records PRODUCTION `verified-release` on the VDS. If the HTTP smoke check
fails, the workflow fails and does not call `verify`.

Example first-run command:

```bash
gh workflow run deploy-production.yml --ref main \
  -f git_sha=<staging-approved-commit-sha> \
  -f image_digest=<sha256-image-digest>
```

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

If repository-side PRODUCTION deployment succeeds but the HTTP smoke check fails,
the workflow does not call the VDS `verify` operation. In that case
PRODUCTION `verified-release` remains the previous known-good version, while
`current-release` may point to the failed candidate. Rollback is not automatic
and requires an explicit operator decision.

## Rollback principle

Production has a defined application rollback path through the repository-side
rollback workflow and the VDS PRODUCTION `previous-release` contract.

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

The exact database migration/rollback strategy may evolve when database
migration tooling is implemented.

## Application rollback

Repository-side PRODUCTION rollback is implemented by:

```text
.github/workflows/rollback-production.yml
```

The workflow is manually triggered with `workflow_dispatch` and must run from
`main`. It does not accept a Git SHA or image digest from the operator.

Rollback target selection is authoritative on the VDS:

```text
previous-release
```

The workflow reads the trusted rollback pair through the restricted PRODUCTION
SSH contract, validates the returned record format locally and then invokes:

```text
rollback <GIT_SHA> <IMAGE_DIGEST>
```

The VDS independently verifies that the requested pair exactly matches trusted
PRODUCTION `previous-release`. If `previous-release` is absent, rollback fails
without changing PRODUCTION.

After rollback succeeds, the workflow verifies that `https://tuttoseriea.com/`
is reachable over HTTP and that the response body is non-empty. Only after that
smoke check succeeds does the workflow invoke:

```text
verify <GIT_SHA> <IMAGE_DIGEST>
```

This records the rollback target as the verified PRODUCTION release.

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

The deployment infrastructure is implemented. The following operational details remain open until they are separately implemented and verified:

- exact migration execution point;
- exact health-check endpoints and contracts;
- expanded deployed-environment smoke coverage beyond the current public HTTP
  availability checks;
- concrete database migration compatibility strategy;
- concrete database backup/recovery procedure.

Do not fill these sections with hypothetical commands. Resolve them from the implemented and tested infrastructure.
