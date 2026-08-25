# AGENTS.md

This file defines the mandatory rules for Codex when working in this repository.

Keep this file lean. Detailed project knowledge belongs in the referenced documentation.

Before modifying an area, read the relevant documentation referenced below.

---

## 1. PROJECT

Russian-language platform focused on Italian football, with Serie A as its initial and primary product scope.
Main components:

- `web/` — Next.js public website, admin panel and domain application;
- `ai-service/` — internal Python/FastAPI service for AI/vector workflows;
- PostgreSQL + pgvector — shared physical database;
- `scripts/` — project/operational scripts;
- root `docker-compose.yml` — production-like containerized stack.

Main stack:

- Next.js App Router + TypeScript;
- Tailwind CSS + shadcn/ui;
- Auth.js;
- PostgreSQL + pgvector;
- Drizzle ORM;
- Python + FastAPI;
- Docker;
- GitHub Actions;
- Cloudflare.

Detailed product definition and product scope:

See `docs/product/overview.md`.

Detailed architecture:

See `docs/architecture/overview.md`.

For system jobs and bulk/background operations, see `docs/jobs/overview.md`.

For SEO/indexing rules, see `docs/seo/overview.md`.

### Key invariants

- `web/` owns domain data.
- `ai-service/` owns AI/vector-specific data.
- FastAPI does not directly read or modify domain tables owned by `web/`.
- `ai-service/` must not couple workflow/domain logic directly to a specific AI provider, model or SDK.
- Drizzle is the single source of truth and migration authority for the entire PostgreSQL schema.
- Do not introduce a second migration authority such as Alembic.
- Next.js ↔ FastAPI communication goes through an explicit HTTP/API boundary.
- FastAPI is internal-only in staging/production.
- Public user-facing requests do not call Football API directly.
- System jobs must be idempotent and protect against duplicate parallel execution using atomic PostgreSQL coordination; never use `SELECT` followed by a separate `INSERT` as concurrency protection.
- Do not introduce new infrastructure or architectural layers without demonstrated need.
- Significant new architectural decisions require explicit user approval.
- Changes to slugs, canonical URLs, indexability or sitemap must follow `docs/seo/overview.md`.

---

## 2. DEVELOPMENT ENVIRONMENT

See `docs/development/overview.md`.

Key rules:

- LOCAL: Next.js and FastAPI run natively on Windows; PostgreSQL + pgvector run in Docker.
- A full production-like Docker Compose stack must be automatically verified before staging.
- Use `pnpm` for Node.js dependencies and `uv` for Python.
- Use Drizzle migrations for every database schema change.
- Database setup follows `migrate → seed`.
- Seed must be minimal, repeatable and idempotent.
- Destructive LOCAL DB reset/recreate is an explicit operation and must not be used as routine troubleshooting.
- Real secrets are never committed.
- External paid/limited providers use fixtures/mocks/fakes by default in LOCAL/tests.
- Real providers require explicit opt-in.

Actual build/test/setup commands must reflect real repository tooling. Never invent commands that do not exist.

---

## 3. CODE AND ARCHITECTURE

See `docs/architecture/overview.md`.

Key rules:

- Use Next.js App Router; do not introduce Pages Router.
- Prefer Server Components unless client-side interactivity requires a Client Component.
- Keep business/domain logic outside React components and HTTP boundaries.
- Authentication and authorization are enforced server-side.
- Route Handlers are HTTP/API boundaries.
- FastAPI domain/workflow logic must not depend on `HTTPException`.
- External API/provider-specific logic must remain behind integration boundaries.
- Do not create abstractions, directories, packages or layers without a real current responsibility.
- Do not perform unrelated refactoring as part of another task.

### API errors

External application error responses use:

`{ error: { code, message, requestId } }`

- `code` is stable and machine-readable.
- UI logic uses `code`, not parsing of `message`.
- `requestId` correlates responses with logs.
- Internal details and stack traces are never exposed to clients.

FastAPI OpenAPI is the source of truth for the FastAPI boundary. TypeScript boundary types are generated with `openapi-typescript`.

---

## 4. TESTING

See `docs/testing/overview.md`.

Main stack:

- Web unit/component — Vitest + React Testing Library;
- FastAPI — pytest;
- E2E — Playwright.

Key rules:

- Protect critical business logic, contracts and user flows; 100% coverage is not a goal.
- Use Unit / Integration / E2E / Smoke according to change risk.
- Next.js ↔ FastAPI contracts require integration protection.
- Automated tests do not call real paid/limited external providers by default.
- Run all relevant available checks after changes.
- Never report a missing or unexecuted check as passed.
- If a required verification level is unavailable, report the gap and do not cross the corresponding control gate without fixing it or receiving explicit user approval.

---

## 5. GIT / SECURITY

See:

- `docs/git-workflow.md`
- `docs/security/overview.md`

Key invariants:

- `main` is protected and stable.
- Work happens in task branches; no long-lived `develop`.
- PR + required CI are mandatory before merge to `main`.
- Never bypass required checks or repository protections.
- Never force-push, rewrite published history or perform destructive Git operations without explicit approval.
- Auth.js uses database sessions.
- Authorization is enforced server-side.
- Secrets must never enter Git, client bundles or logs.
- Never weaken authentication, authorization or other security controls merely to make something work.
- Significant, bulk and system operations require safeguards appropriate to their risk.

---

## 6. CODEX WORKFLOW

These rules are mandatory and take precedence over convenience or speed.

### Standard flow

`task → analyze → plan → ПЛАН ОДОБРЕН → implement → automated checks → manual LOCAL check → LOCAL OK → commit → push → PR → CI → main → staging → manual STAGING check → STAGING OK → wait → DEPLOY PRODUCTION → production`

### Planning

Before implementation Codex must:

- inspect relevant code and documentation;
- distinguish verified facts from assumptions;
- stay within the requested scope;
- present an implementation plan.

Do not start implementation until the user sends:

`ПЛАН ОДОБРЕН`

If the plan is rejected or corrected, update it and wait again for `ПЛАН ОДОБРЕН`.

If implementation reveals a significant architectural decision not already approved, stop and ask the user. Do not resolve documented Open Questions independently.

### LOCAL

After implementation:

- run relevant available automated checks;
- report exactly what was and was not checked;
- provide a clear manual LOCAL verification scenario;
- stop and wait.

Only:

`LOCAL OK`

authorizes:

`commit → push → PR → CI → main → staging`

If LOCAL fails:

`ОШИБКА LOCAL: <описание>`

Fix within the approved scope, rerun relevant checks and return to manual LOCAL verification.

### STAGING

After successful CI/merge/deployment to staging, provide a manual STAGING verification scenario and wait.

`STAGING OK`

means only that the specific tested commit/version is approved for production.

It does **not** authorize production deployment.

After `STAGING OK`, report that the version is ready for production and stop.

If staging fails:

`ОШИБКА STAGING: <описание>`

Remain in the staging workflow.

### PRODUCTION

See `docs/operations/deployment.md` for deployment mechanics, rollback procedure and health-check details.

Production deployment is allowed only after:

`DEPLOY PRODUCTION`

Deploy the exact version previously approved by `STAGING OK`, then run the available production smoke/health checks.

If production fails:

`ОШИБКА PRODUCTION: <описание>`

Do not perform destructive recovery without explicit approval.

### Failure / loop protection

Do not repeat the same unsuccessful approach indefinitely.

After several attempts without meaningful progress:

- stop;
- state the confirmed problem;
- summarize what was tried;
- state what is missing;
- ask the user how to proceed.

Never use the following as an autonomous escape from a failure:

- destructive DB reset/recreate;
- destructive Git reset/history rewrite;
- force push;
- deletion of data;
- disabling tests/CI;
- weakening authentication/authorization/security;
- weakening infrastructure protections.

Destructive actions require explicit user approval.

### Bulk and side-effect operations

Writing a mechanism for a bulk operation does **not** authorize executing it.

Historical imports, backfills, reindexing, mass AI processing, mass data changes, mass publication, mass creation of indexable pages and similar operations require separate explicit approval before execution.

Before execution, state what will be processed and the expected scope.

Real paid, limited or external side-effect operations must not be triggered silently for development or testing.

### Documentation

When a change actually modifies architecture, setup, contracts or operations, update the relevant documentation in the same PR.

Do not update documentation merely for appearance.

Do not change `AGENTS.md` as a side effect of an ordinary feature. Changes to these rules require an explicit decision.