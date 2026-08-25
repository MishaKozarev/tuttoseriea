# LOCAL Setup

This document describes the LOCAL development setup sequence.

It must reflect the actual repository tooling and configuration.

Do not add commands here unless they exist and have been verified in the repository.

For general development rules, see `overview.md`.

For database architecture, see `../architecture/database.md`.

For testing rules, see `../testing/overview.md`.

## Prerequisites

The LOCAL environment requires:

- supported Node.js version;
- `pnpm`;
- supported Python version;
- `uv`;
- Docker / Docker Compose;
- Git.

The exact supported Node.js and Python versions must match the real project configuration.

Do not guess or document versions that are not yet established in repository tooling.

## Repository bootstrap

The general bootstrap sequence is:

1. clone the repository;
2. install Node.js dependencies for `web/`;
3. install Python dependencies for `ai-service/`;
4. create LOCAL environment configuration from service-specific `.env.example` files;
5. start PostgreSQL + pgvector in Docker;
6. apply Drizzle migrations;
7. run seed;
8. start Next.js;
9. start FastAPI;
10. run the relevant LOCAL checks.

Concrete commands are added only after the corresponding scripts/tooling exist.

### Current `web/` commands

The current `web/` foundation has concrete pnpm scripts.

From `web/`:

```bash
pnpm install
pnpm dev
pnpm lint
pnpm build
```

On Windows PowerShell, if script execution policy blocks `pnpm.ps1`, use `pnpm.cmd`
with the same arguments.

Use `pnpm install` for a fresh clone or when dependencies are missing. If `create-next-app`
has already installed dependencies during bootstrap, do not rerun install unless the actual
project state requires it.

`pnpm dev` starts the Next.js development server. The default LOCAL URL is
`http://localhost:3000` unless the port is already occupied.

## Environment files

Service-specific LOCAL configuration is based on:

- `web/.env.example`;
- `ai-service/.env.example`.

A root `.env.example` is not used as the shared configuration source.

Create real LOCAL `.env` files from the corresponding examples.

Never commit real `.env` files or credentials.

If the same logical value is required by both services, it may appear explicitly in both service configurations.

Do not introduce a hidden shared ENV/config layer only to remove duplication.

## PostgreSQL + pgvector

Normal LOCAL development runs PostgreSQL + pgvector in Docker.

The Docker configuration must provide the database required by both `web/` and `ai-service/`.

Database schema must be created through Drizzle migrations.

Do not create schema manually.

Do not use Alembic or an independent FastAPI migration history.

The normal database preparation order is:

`migrate → seed`

## Migrations

Every schema change follows the project migration workflow:

1. modify Drizzle schema;
2. generate the migration using the actual project command;
3. review the generated migration where appropriate;
4. apply the migration to LOCAL PostgreSQL;
5. run relevant checks.

The exact migration commands must be documented here after they exist in the repository.

Do not modify production or LOCAL schema manually as a substitute for creating the required migration.

## Seed

Seed must provide a minimal useful LOCAL dataset.

It should be safe to run repeatedly and must not continuously create duplicate logical records.

The seed may include, as required by implemented features:

- normal test user;
- admin user;
- competitions;
- teams;
- players;
- matches;
- minimal news/content data;
- other feature-specific development data.

AI/vector seed data is added only when a concrete feature requires it.

Real paid AI calls must not be required to seed LOCAL data.

Large scenario-specific fixtures must not load automatically unless explicitly required by the corresponding development/test workflow.

## LOCAL database reset

Destructive reset/recreate of the LOCAL database is not part of the normal bootstrap or troubleshooting flow.

Do not use reset/recreate to:

- bypass migration problems;
- hide inconsistent schema state;
- escape repeated failed debugging attempts;
- return the environment to a convenient state without understanding the cause.

If reset is genuinely required, it must be treated as a separate explicit operation and authorized according to root `AGENTS.md`.

The exact reset command must not be added here until the project deliberately implements such an operation.

## Starting services

Daily LOCAL development uses the hybrid model:

- PostgreSQL + pgvector in Docker;
- Next.js natively on Windows;
- FastAPI natively on Windows.

Concrete start commands must be added here from actual repository scripts/tooling.

The current Next.js start command exists:

```bash
cd web
pnpm dev
```

Do not replace the agreed LOCAL model with an all-container workflow unless the architecture is explicitly changed.

## External providers

Normal LOCAL startup must not automatically call real paid, limited or side-effect external services.

By default, use controlled development/test mechanisms such as:

- fixtures;
- mocks;
- fake providers;
- sandbox environments where available.

Real external provider calls require explicit opt-in.

This applies especially to:

- AI providers;
- Football API;
- other quota-limited integrations;
- operations capable of sending real external messages or changing external state.

Starting LOCAL or running ordinary automated checks must not silently consume real provider budget/quota.

## Production-like Docker verification

Separate from daily LOCAL development, the project maintains a full production-like Docker Compose stack.

Its purpose is to verify:

- container builds;
- service networking;
- runtime dependencies;
- integration of the full stack;
- environment/configuration assumptions.

The exact command must be added after the real Docker Compose workflow exists.

This verification is required before staging according to the project's CI/deployment workflow.

## LOCAL checks

After setup or relevant code changes, run the checks required for the affected area.

The actual commands may include:

- lint;
- format check;
- typecheck;
- unit/component tests;
- FastAPI tests;
- integration tests;
- E2E tests;
- production build;
- Docker Compose verification.

Only commands that really exist in the repository should be documented or reported as executed.

For the current `web/` foundation:

```bash
cd web
pnpm lint
pnpm build
```

For mandatory testing rules, see `../testing/overview.md`.

## First-run verification

After successful bootstrap, verify at minimum that:

- PostgreSQL is running and reachable;
- required migrations are applied;
- seed completes successfully;
- Next.js starts successfully;
- FastAPI starts successfully;
- the defined service boundary is reachable where required;
- relevant health/check endpoints work once they exist.

The concrete URLs, ports and health endpoints must be added after they are established by the project.

## Keeping this document current

Update this document whenever the real LOCAL bootstrap process changes.

Examples:

- package manager command changes;
- supported runtime version changes;
- Docker service changes;
- migration/seed command changes;
- new required LOCAL dependency;
- new required bootstrap step.

Do not update this document with hypothetical commands or planned tooling.

## Open Questions

The following details must be filled from the real repository after bootstrap:

- exact supported Node.js version;
- exact supported Python version;
- exact Python dependency installation commands;
- exact PostgreSQL/Docker Compose command;
- exact Drizzle migration commands;
- exact seed command;
- exact FastAPI start command;
- exact LOCAL ports beyond the default Next.js development URL;
- exact health/check URLs beyond the default Next.js page;
- exact production-like Docker verification command.
