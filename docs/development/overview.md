# Development Overview

This document defines the general development environment and development-time rules for the project.

For detailed LOCAL setup and actual repository commands, see `local-setup.md`.

For architecture rules, see `../architecture/overview.md`.

For testing rules, see `../testing/overview.md`.

## Development model

The current runnable repository state is a minimal Next.js foundation in `web/`.

Current LOCAL development runs:

- Next.js natively on Windows.

Future full-stack LOCAL development uses the agreed hybrid environment:

- Next.js runs natively on Windows;
- FastAPI runs natively on Windows;
- PostgreSQL + pgvector run in Docker.

Developers do not need to run the entire application stack in containers for normal daily development.

The current `web/` application has a production container image definition in
`web/Dockerfile`. This supports container delivery verification separately from
daily native LOCAL development.

Once the repository production-like Docker Compose verification workflow exists,
it must verify that the services work correctly together in containers before
staging.

## Tooling

The current runnable `web/` foundation requires:

- Node.js `24.x`;
- `pnpm` `11.23.0` for Node.js dependency management;
- Docker Engine for `web/` production container build and smoke verification;
- Git;
- GitHub CLI (`gh`) for Codex/operator GitHub workflow tasks such as Pull Request
  and required check inspection.

The planned full-stack project also uses:

- `uv` for Python dependency management;
- Drizzle for PostgreSQL schema and migrations;
- Docker Compose for PostgreSQL + pgvector in normal LOCAL development and for the
  production-like containerized stack.

Do not pin exact Python, `uv`, Git, GitHub CLI, WSL2, Docker Desktop, Docker Engine
or Docker Compose versions until repository tooling establishes a project requirement.

Do not introduce alternative package managers or migration systems without an explicit decision.

Actual commands must reflect tooling that really exists in the repository.

Never invent a command merely because it would be conventional for the stack.

## Environment configuration

Configuration is service-specific.

The current runnable `web/` foundation does not require LOCAL environment files.

When service environment configuration exists, `web/` and `ai-service/` maintain
their own environment configuration and `.env.example` files.

A shared root `.env.example` is not used as a general configuration layer.

Real secrets must never be committed.

`.env.example` files contain only:

- variable names;
- safe example values where appropriate;
- enough context to understand required configuration.

They must not contain real credentials, tokens or production secrets.

Detailed security rules are documented in `../security/overview.md`.

## Database setup

Database setup is not implemented in the current runnable `web/` foundation.

Future PostgreSQL + pgvector setup runs in Docker during normal LOCAL development.

Database schema changes use Drizzle migrations.

Drizzle is the only migration authority for the entire database, including AI/vector tables.

Do not introduce Alembic or another independent migration history for `ai-service/`.

Future database initialization follows:

`migrate → seed`

Detailed database architecture is documented in `../architecture/database.md`.

## Seed strategy

LOCAL seed data should provide only the minimum useful development state.

Seed must be:

- repeatable;
- idempotent;
- safe to execute more than once without continuously creating duplicate logical data.

Seed is not intended to reproduce the complete production dataset.

Destructive LOCAL database reset/recreate is a separate explicit operation.

Do not use destructive reset as:

- routine troubleshooting;
- an automatic response to migration failure;
- an escape from repeated unsuccessful attempts.

If destructive reset is actually required, it must be explicitly authorized according to the workflow rules in root `AGENTS.md`.

## External services in LOCAL

Development and automated testing must not depend on real paid or limited external providers by default.

This includes, where applicable:

- AI providers;
- Football API providers;
- other paid, quota-limited or side-effecting external services.

Use fixtures, mocks, fakes or other controlled test implementations where appropriate.

Real provider usage requires explicit opt-in.

A developer must not accidentally spend provider quota or money merely by:

- starting the application;
- running automated tests;
- running normal LOCAL development commands.

Provider-specific integration architecture is documented in `../architecture/integrations.md`.

AI-provider architecture is documented in `../architecture/ai-service.md`.

## Container verification

The current repository implements production container build and smoke verification
for the `web/` application.

Current `web/` container delivery:

- `web/Dockerfile` builds a production Next.js standalone image;
- `.github/workflows/ci.yml` builds and smoke-checks that image in the required
  `Web` job;
- on `push` to `main`, the same CI job publishes the image to GHCR as
  `ghcr.io/mishakozarev/tuttoseriea/web:sha-<commit-sha>`.

STAGING and PRODUCTION infrastructure use the same immutable image digest from
GHCR. The image is built once in CI and promoted by digest, not rebuilt per
environment.

Full-stack production-like Docker Compose verification is separate from the
single-service `web/` image smoke check.

The VDS infrastructure already has separate Docker Compose projects for STAGING
and PRODUCTION. Repository commands for deploying a selected image digest through
those projects are documented only after they are implemented and verified.

Its purpose is to detect problems that native LOCAL development may not expose, such as:

- container build failures;
- service networking problems;
- incorrect container configuration;
- missing runtime dependencies;
- differences between native and containerized execution.

This containerized verification is a required pre-staging protection, not the default daily development environment.

The exact full-stack Compose verification command must reflect the actual
repository tooling and be documented when it exists.

## Development checks

After implementation, run the relevant checks that actually exist for the affected area.

Depending on the change, these may include:

- lint;
- type checking;
- unit/component tests;
- FastAPI tests;
- integration tests;
- E2E tests;
- production build;
- production-like Docker Compose verification.

Detailed test requirements are defined in `../testing/overview.md`.

For the current `web/` foundation, the available checks are:

```bash
cd web
pnpm lint
pnpm build
cd ..
docker build -f web/Dockerfile -t tuttoseriea-web:local web
```

Run the built `web` container and verify that the application responds when the
change affects container delivery.

Do not claim that a check passed if:

- the command does not exist;
- the tooling is not configured;
- the check was not executed;
- execution failed.

If a required check does not yet exist, report the gap instead of silently treating it as successful.

## LOCAL workflow boundary

Implementation and automated checks do not authorize Git progression.

After implementation and relevant automated checks, Codex provides a manual LOCAL verification scenario and waits.

Only the explicit command:

`LOCAL OK`

authorizes the Git/PR/CI progression defined in root `AGENTS.md`.

If LOCAL verification fails, the user reports:

`ОШИБКА LOCAL: <описание>`

The problem is corrected within the approved scope and the LOCAL verification stage is repeated.

Detailed Git workflow is documented in `../git-workflow.md`.

## Documentation

When development setup, environment configuration or repository commands actually change, update the relevant development documentation in the same PR.

Do not document commands that are merely planned or assumed.

`local-setup.md` should contain concrete setup steps and commands that correspond to the actual repository state.

## Open Questions

The following development details remain open until the repository implementation establishes them:

- exact full-stack LOCAL bootstrap commands beyond the current `web/` foundation;
- exact Drizzle migration commands;
- exact seed command;
- exact service start commands beyond the current Next.js development server;
- exact full-stack production-like Docker Compose verification command;
- exact environment variable sets for services that require LOCAL environment configuration.

These must be documented from real repository tooling rather than invented in advance.
