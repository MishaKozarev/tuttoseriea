# LOCAL Setup

This document describes the LOCAL development setup sequence.

It must reflect the actual repository tooling and configuration.

Do not add commands here unless they exist and have been verified in the repository.

For general development rules, see `overview.md`.

For database architecture, see `../architecture/database.md`.

For testing rules, see `../testing/overview.md`.

## Prerequisites

The current runnable `web/` foundation requires:

- Git.
- Node.js `24.x`.
- `pnpm` `11.23.0`.
- Docker Engine for `web/` production container build and smoke verification.
- GitHub CLI (`gh`) authenticated to GitHub for Codex/operator GitHub workflow
  tasks such as Pull Request and required check inspection.

Do not pin a specific LOCAL Node.js patch version in project documentation.

The pnpm version is a project requirement because it is pinned in `web/package.json`
and used by GitHub Actions CI.

Python, `uv`, WSL2 and Docker Compose are part of the planned full-stack
development environment, but their exact project versions are not pinned yet.
Do not turn observed versions from one developer machine into project requirements
until the corresponding repository tooling exists. Do not pin a Docker Desktop,
Docker Engine or Docker Compose patch version unless repository tooling establishes
that requirement.

## Repository bootstrap

The current repository contains a runnable `web/` foundation only.

Current bootstrap sequence:

1. clone the repository;
2. install Node.js dependencies for `web/`;
3. start the Next.js development server;
4. run the current `web/` checks when verifying changes;
5. build and smoke-check the `web/` production container when verifying container
   delivery changes.

Future full-stack bootstrap will add `ai-service`, service environment files,
PostgreSQL + pgvector in Docker, Drizzle migrations, seed and FastAPI startup
after the corresponding repository tooling exists.

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

`pnpm start` is available for optional local execution of an already built Next.js
application after `pnpm build`. It is not a CI check and is not a mandatory LOCAL
verification command. The production container build enables Next.js standalone
output inside Docker and uses the generated standalone server, not `pnpm start`.

### Current `web/` container commands

The `web/` production image is built from `web/Dockerfile`.

From repository root:

```bash
docker build -f web/Dockerfile -t tuttoseriea-web:local web
docker run --rm -p 3000:3000 tuttoseriea-web:local
```

If host port `3000` is already occupied, map another host port to container port
`3000`, for example:

```bash
docker run --rm -p 3001:3000 tuttoseriea-web:local
```

The container should serve the current `web/` application on the selected host
port.

## Environment files

The current runnable `web/` foundation does not require LOCAL environment files
and does not include a `web/.env.example`.

Future service-specific LOCAL configuration will be based on:

- `web/.env.example`;
- `ai-service/.env.example`.

A root `.env.example` is not used as the shared configuration source.

Create real LOCAL `.env` files from the corresponding examples after those
examples exist.

Never commit real `.env` files or credentials.

If the same logical value is required by both services, it may appear explicitly in both service configurations.

Do not introduce a hidden shared ENV/config layer only to remove duplication.

## PostgreSQL + pgvector

PostgreSQL + pgvector are not part of the current runnable `web` foundation yet.

Future normal LOCAL development will run PostgreSQL + pgvector in Docker.

The Docker configuration must provide the database required by both `web/` and `ai-service/`.

Database schema must be created through Drizzle migrations.

Do not create schema manually.

Do not use Alembic or an independent FastAPI migration history.

The normal database preparation order is:

`migrate → seed`

The exact Docker Compose command must be documented here after the real Docker
Compose workflow exists.

## Migrations

No Drizzle schema or migration commands exist in the current runnable foundation.

Every future schema change follows the project migration workflow:

1. modify Drizzle schema;
2. generate the migration using the actual project command;
3. review the generated migration where appropriate;
4. apply the migration to LOCAL PostgreSQL;
5. run relevant checks.

The exact migration commands must be documented here after they exist in the repository.

Do not modify production or LOCAL schema manually as a substitute for creating the required migration.

## Seed

No seed command exists in the current runnable foundation.

Future seed must provide a minimal useful LOCAL dataset.

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

The current runnable service is Next.js.

Future daily LOCAL development uses the hybrid model:

- PostgreSQL + pgvector in Docker;
- Next.js natively on Windows;
- FastAPI natively on Windows.

Concrete start commands must be added here from actual repository scripts/tooling.

The current Next.js start command exists:

```bash
cd web
pnpm dev
```

Optional local execution of the built Next.js app:

```bash
cd web
pnpm build
pnpm start
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

## Container verification

The current repository implements production container build and smoke verification
for the `web/` application.

Separate from daily LOCAL development, `web/Dockerfile` builds the production
Next.js standalone image. The required GitHub Actions `Web` job builds and
smoke-checks this image. On `push` to `main`, CI publishes the image to GHCR as:

```text
ghcr.io/mishakozarev/tuttoseriea/web:sha-<commit-sha>
```

The image digest published by CI is the immutable deployment identity used by
both STAGING and PRODUCTION infrastructure.

Full-stack production-like Docker Compose verification remains separate from the
single-service `web/` container smoke check.

The VDS infrastructure already has separate Docker Compose projects for STAGING
and PRODUCTION. The repository must document the concrete commands for deploying
a selected image digest through those projects after those commands are implemented
and verified.

Its purpose is to verify:

- container builds;
- service networking;
- runtime dependencies;
- integration of the full stack;
- environment/configuration assumptions.

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
cd ..
docker build -f web/Dockerfile -t tuttoseriea-web:local web
```

When the change affects container delivery, also run the built container and
verify that the application responds on the mapped host port.

No unit, component, integration, E2E or full-stack Docker Compose verification
commands exist yet.

For mandatory testing rules, see `../testing/overview.md`.

## First-run verification

After successful current `web` bootstrap, verify at minimum that:

- Next.js starts successfully with `pnpm dev`;
- the default Next.js page is reachable at `http://localhost:3000` unless the port
  is already occupied;
- `pnpm lint` succeeds;
- `pnpm build` succeeds;
- `docker build -f web/Dockerfile -t tuttoseriea-web:local web` succeeds when
  verifying container delivery.

Future full-stack verification will add checks that:

- PostgreSQL is running and reachable;
- required migrations are applied;
- seed completes successfully;
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

- exact supported Python version;
- exact Python dependency installation commands;
- exact PostgreSQL/Docker Compose command;
- exact Drizzle migration commands;
- exact seed command;
- exact FastAPI start command;
- exact LOCAL ports beyond the default Next.js development URL;
- exact health/check URLs beyond the default Next.js page;
- exact full-stack Docker Compose verification command.
