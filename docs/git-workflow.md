# Git Workflow

This document defines the Git, branch, pull request and merge workflow for the project.

Root `AGENTS.md` is authoritative for Codex workflow gates and explicit user control commands.

For testing requirements, see `testing/overview.md`.

For development rules, see `development/overview.md`.

For deployment workflow, see `operations/deployment.md`.

## Repository model

The project uses one Git repository across LOCAL, staging and production development stages.

`main` is the stable protected branch.

Development work happens in task-specific branches.

There is no long-lived `develop` branch.

The normal code progression is:

    task branch
        ↓
    Pull Request
        ↓
    required CI
        ↓
    main
        ↓
    staging
        ↓
    manual staging verification
        ↓
    production approval
        ↓
    production

The exact authorization to move between these stages is defined by the control gates in root `AGENTS.md`.

## Branches

Create a dedicated branch for a concrete task or coherent change.

Use clear branch names appropriate to the work, for example:

- `feature/...`;
- `fix/...`;
- `refactor/...`;
- `docs/...`;
- another task-oriented prefix where appropriate.

Do not create a permanent integration branch merely to mirror `main`.

Keep branches focused enough that their Pull Request can be reviewed and verified as one coherent change.

Do not mix unrelated work into the same branch without a concrete reason.

## `main`

`main` must remain stable and protected.

Do not use `main` as the normal development workspace.

Changes reach `main` through the approved Pull Request workflow.

Required repository protections and required CI must not be bypassed merely to merge faster.

Do not treat merge to `main` as authorization for production deployment.

### Current branch protection

GitHub branch protection is configured for the exact branch `main`.

Enabled protections:

- require a Pull Request before merging;
- required approving reviews: `0`;
- require status checks to pass before merging;
- required status check: `Web`;
- expected status check source: GitHub Actions;
- administrators are included in the configured protections;
- force pushes are disabled;
- branch deletion is disabled.

The required status check does not require branches to be up to date before merging.

The current protection does not configure:

- repository rulesets;
- push restrictions;
- required deployments;
- signed commits;
- linear history;
- merge queue;
- conversation resolution;
- code owner review;
- stale review dismissal;
- last-push approval.

## Commits

Commits should represent understandable units of work.

Commit messages should clearly describe the change.

Do not create misleading commit messages that hide the actual scope of the change.

Before creating commits, verify that the intended change does not accidentally include:

- secrets;
- LOCAL environment files;
- generated temporary files;
- debugging artifacts;
- unrelated modifications.

Do not rewrite already published/shared history without explicit user approval.

## Pull Requests

Changes to `main` go through a Pull Request.

A PR should make the change understandable without requiring reconstruction from the commit history alone.

Where relevant, the PR should communicate:

- what changed;
- why it changed;
- important implementation decisions;
- relevant verification performed;
- known limitations or unresolved questions;
- migration/deployment implications.

Do not describe a check as successful if it was not actually executed successfully.

## Required CI

Required CI is a mandatory condition for merge to `main`.

The exact checks depend on the repository configuration and the affected change.

Testing requirements are defined in `testing/overview.md`.

### Current GitHub Actions CI

The current repository CI workflow is `.github/workflows/ci.yml`.

It runs on:

- `pull_request` targeting `main`;
- `push` to `main`.

The current workflow name is `CI`.

The current required job for the existing repository state is:

- `Web` — installs `web/` dependencies from `web/pnpm-lock.yaml`, runs `pnpm run lint`
  and `pnpm run build` in `web/`, builds the `web` production container image,
  and smoke-checks that container over HTTP.

On `push` to `main`, the same `Web` job publishes the successfully smoke-checked
image to GHCR as:

```text
ghcr.io/mishakozarev/tuttoseriea/web:sha-<commit-sha>
```

Pull Request CI does not publish images.

This is the minimal CI for the existing Next.js foundation. It does not run FastAPI,
database, full-stack Docker Compose, E2E or staging/production deployments.
Staging and production deployment are separate manually gated workflows, not
automatic required CI checks.

If a required check:

- does not exist yet;
- cannot be executed;
- fails;
- is unavailable for another reason;

do not treat it as passed.

Report the gap and follow the control rules in root `AGENTS.md`.

Do not:

- disable a required check merely to merge;
- weaken a test merely to obtain green CI;
- silently remove required verification;
- bypass branch protection.

## LOCAL gate

Successful implementation and automated LOCAL checks do not independently authorize Git progression.

Codex must follow the LOCAL control gate defined in root `AGENTS.md`.

Only the explicit user command:

`LOCAL OK`

authorizes the approved progression from LOCAL work into the Git/PR/CI workflow.

Do not infer approval from:

- successful tests;
- successful build;
- successful manual instructions;
- positive conversational wording that is not the defined control command.

If LOCAL verification fails, follow the error/recovery workflow defined in root `AGENTS.md`.

## Merge

Merge is allowed only when:

- the approved change is represented by the PR;
- required CI has passed;
- repository protections are satisfied;
- the applicable control gate in root `AGENTS.md` authorizes progression.

Do not merge unrelated additional changes merely because they are already present in the branch.

The commit/version that progresses through staging must remain identifiable.

Ordinary Pull Requests are merged with GitHub's `Squash and merge` option.
Using `Create a merge commit` or `Rebase and merge` for a specific Pull Request
requires a separate explicit decision.

After merge, synchronize local repository state before starting another task.
The mandatory Codex post-merge alignment rule is defined in root `AGENTS.md`.

## Staging

Staging validates the version produced by the approved Git/CI process.

Staging is not an informal continuation of LOCAL development.

The current repository-side STAGING deployment workflow is
`.github/workflows/deploy-staging.yml`. It is manually triggered after a version
has reached `main` and the required push-to-main CI has produced a GHCR image.

The workflow accepts:

- `git_sha` - a commit that must be an ancestor of current `origin/main`;
- `image_digest` - the immutable GHCR digest that must match
  `ghcr.io/mishakozarev/tuttoseriea/web:sha-<git_sha>`.

After validation, the workflow deploys through the documented VDS SSH contract
and runs the current STAGING HTTP smoke check. Deployment mechanics are documented
in `operations/deployment.md`.

If staging exposes a problem, fix it through the normal repository workflow rather than manually modifying the staging environment as an undocumented patch.

Manual staging verification is controlled by root `AGENTS.md`.

`STAGING OK` applies to the specific version/commit that was actually verified.

After `STAGING OK`, the separate `.github/workflows/verify-staging.yml` workflow
records the approved Git SHA and immutable image digest as trusted STAGING
`verified-release` through the documented VDS contract. This step does not deploy
to production.

A later code change invalidates that approval for the changed version.

## Production

Production deployment is a separate explicitly authorized stage.

Successful merge, CI or staging verification does not by itself authorize production deployment.

Production deployment requires the explicit production control command defined in root `AGENTS.md`.

The current repository-side PRODUCTION deployment workflow is
`.github/workflows/deploy-production.yml`. It is manually triggered only after
the explicit production gate and deploys the STAGING-approved Git SHA and
immutable GHCR image digest without rebuilding the image.

The current repository-side PRODUCTION rollback workflow is
`.github/workflows/rollback-production.yml`. It is manually triggered as a
recovery action, obtains the rollback target from trusted VDS
`previous-release`, then rolls back and verifies PRODUCTION through the documented
VDS contract.

Deployment mechanics, rollback and health verification are documented in:

`operations/deployment.md`

## Failure handling

A failure at a workflow stage must be handled at that stage.

Do not bypass a failed gate by moving to the next environment.

Examples:

- LOCAL failure → fix and repeat LOCAL verification;
- CI failure → fix through the repository/PR workflow and rerun required CI;
- staging failure → fix through the repository workflow and redeploy the corrected version;
- production failure → follow the production failure/rollback procedure.

Do not patch tracked application code directly on staging or production servers as the normal way to fix a deployment.

The repository must remain the source of truth for deployed application code.

## Destructive Git operations

The following require explicit user approval when they can affect shared/published work:

- force push;
- rewriting published history;
- destructive reset;
- deleting important shared branches;
- other irreversible/destructive Git operations.

Do not use destructive Git operations merely as a convenient way to escape a difficult repository state.

Prefer understanding and correcting the actual state.

## Documentation changes

Documentation changes follow the same repository workflow as code.

When a code change modifies documented:

- architecture;
- setup;
- contracts;
- testing behavior;
- security rules;
- operations;

update the relevant documentation in the same PR.

Do not create documentation describing planned implementation as though it already exists.

Root `AGENTS.md` remains the control plane for mandatory Codex rules and routing; detailed project knowledge belongs in `docs/`.

## Open Questions

The following details depend on the actual repository/platform configuration and remain open until implemented:

- exact PR template/content requirements.

These details must be documented from the real repository configuration rather than assumed in advance.
