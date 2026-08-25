# Development Overview

This document defines the general development environment and development-time rules for the project.

For detailed LOCAL setup and actual repository commands, see `local-setup.md`.

For architecture rules, see `../architecture/overview.md`.

For testing rules, see `../testing/overview.md`.

## Development model

Daily LOCAL development uses a hybrid environment:

- Next.js runs natively on Windows;
- FastAPI runs natively on Windows;
- PostgreSQL + pgvector run in Docker.

Developers do not need to run the entire application stack in containers for normal daily development.

At the same time, the project must maintain a production-like Docker Compose stack that can verify that the services work correctly together in containers before staging.

## Tooling

The project uses:

- `pnpm` for Node.js dependency management;
- `uv` for Python dependency management;
- Drizzle for PostgreSQL schema and migrations;
- Docker for PostgreSQL + pgvector in normal LOCAL development and for the production-like containerized stack.

Do not introduce alternative package managers or migration systems without an explicit decision.

Actual commands must reflect tooling that really exists in the repository.

Never invent a command merely because it would be conventional for the stack.

## Environment configuration

Configuration is service-specific.

`web/` and `ai-service/` maintain their own environment configuration and `.env.example` files.

A shared root `.env.example` is not used as a general configuration layer.

Real secrets must never be committed.

`.env.example` files contain only:

- variable names;
- safe example values where appropriate;
- enough context to understand required configuration.

They must not contain real credentials, tokens or production secrets.

Detailed security rules are documented in `../security/overview.md`.

## Database setup

PostgreSQL + pgvector run in Docker during normal LOCAL development.

Database schema changes use Drizzle migrations.

Drizzle is the only migration authority for the entire database, including AI/vector tables.

Do not introduce Alembic or another independent migration history for `ai-service/`.

Normal database initialization follows:

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

## Production-like Docker verification

The repository must maintain a production-like Docker Compose configuration for integration verification.

Its purpose is to detect problems that native LOCAL development may not expose, such as:

- container build failures;
- service networking problems;
- incorrect container configuration;
- missing runtime dependencies;
- differences between native and containerized execution.

This containerized verification is a required pre-staging protection, not the default daily development environment.

The exact command and CI implementation must reflect the actual repository tooling and are documented when they exist.

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

- exact LOCAL bootstrap commands;
- exact Drizzle migration commands;
- exact seed command;
- exact service start commands;
- exact production-like Docker Compose verification command;
- exact environment variable sets for each service.

These must be documented from real repository tooling rather than invented in advance.