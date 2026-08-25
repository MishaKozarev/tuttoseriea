# Database Architecture

This document defines the database ownership, access and migration architecture of the project.

For the overall system architecture, see `overview.md`.

## Database platform

The project uses:

- PostgreSQL as the primary relational database;
- pgvector for vector-specific storage and search.

PostgreSQL + pgvector form one shared physical database used by both `web/` and `ai-service/`.

A shared physical database does not mean shared ownership of all data.

Logical data ownership remains separated between services.

## Data ownership

### `web/` ownership

`web/` owns the project's domain data.

This includes entities such as:

- users;
- news and articles;
- matches;
- teams;
- players;
- competitions;
- comments;
- other core domain entities.

Domain data is accessed through the appropriate application/domain layer.

SQL or Drizzle queries should not be scattered through React components, Route Handlers or unrelated infrastructure code.

### `ai-service/` ownership

`ai-service/` owns AI/vector-specific data.

This may include:

- embeddings;
- AI processing state;
- AI jobs;
- retrieval metadata;
- other data whose responsibility belongs specifically to AI workflows.

FastAPI may access its own AI/vector tables directly through PostgreSQL.

FastAPI must not directly read or modify domain tables owned by `web/`.

When an AI workflow needs domain data owned by `web/`, it must use the defined Next.js ↔ FastAPI service boundary rather than bypassing ownership through direct database access.

## Schema ownership

Drizzle schema is the single source of truth for the entire PostgreSQL schema.

This includes:

- domain tables owned by `web/`;
- AI/vector tables owned by `ai-service/`;
- pgvector-related schema;
- indexes, constraints and other database schema objects managed by the application.

Drizzle migrations are the project's single migration authority.

Do not introduce a second independent migration system such as Alembic.

The fact that FastAPI owns particular data does not give FastAPI independent ownership of database schema migrations.

If an `ai-service/` change requires a schema change, the database change is still represented through Drizzle schema and migrations.

## Migration rules

Every persistent schema change must be represented by a migration.

Do not rely on manual production database modifications as the normal schema-management process.

Migrations must be part of the same change that requires the new schema.

Application code must not assume that an uncommitted or undocumented manual database change exists.

Database setup follows:

`migrate → seed`

Detailed LOCAL setup and migration commands are documented in:

`../development/overview.md`

## Seed data

Seed data exists to make LOCAL development and testing practical.

Seed must be:

- minimal;
- repeatable;
- idempotent.

Running seed multiple times must not continuously create duplicate logical data.

Seed is not a substitute for migrations.

Destructive database reset/recreate is a separate explicit operation and must not be used as routine troubleshooting or as an automatic escape from a failed migration/seed state.

## Access boundaries

Database access should follow application responsibilities rather than convenience.

### Next.js

Domain queries and mutations should be organized through the appropriate application/domain layer.

React components should not become arbitrary database-access layers.

Route Handlers are HTTP boundaries and should delegate domain work rather than accumulating database/business logic.

### FastAPI

FastAPI database infrastructure should provide technical database access to AI/vector-owned data.

Database infrastructure must not become a location for unrelated workflow/business logic.

FastAPI workflow/domain code should depend on application-level abstractions and errors rather than HTTP-specific behavior.

## Transactions

Transactions are used when a logical operation requires atomic database state.

Do not automatically wrap long-running external/API workflows in one large database transaction.

For background/system jobs, prefer short transactional steps with explicit persisted progress where appropriate.

Job-specific transaction, idempotency and concurrency rules are documented in:

`../jobs/overview.md`

## Concurrency

Database concurrency guarantees must rely on atomic database mechanisms rather than application-level check-then-act assumptions.

For system jobs, PostgreSQL is the default coordination layer.

Do not use:

`SELECT → check absence → separate INSERT`

as protection against duplicate parallel execution.

Use an atomic database mechanism appropriate to the concrete operation.

Detailed job coordination rules are documented in:

`../jobs/overview.md`

## pgvector

pgvector belongs to the same PostgreSQL platform and migration authority as the relational schema.

Vector-specific data belongs to the AI/vector ownership boundary.

The existence of pgvector does not change the service ownership rules:

- `web/` owns domain data;
- `ai-service/` owns AI/vector-specific data;
- Drizzle owns schema definition and migrations.

Detailed AI/vector workflow architecture is documented in:

`ai-service.md`

## Open Questions

### References between AI/vector and domain data

A universal project-wide rule for foreign keys versus logical references between AI/vector tables and domain entities is intentionally not defined yet.

The decision must be made for a concrete relationship based on its actual lifecycle, consistency and ownership requirements.

Do not introduce a project-wide FK or no-FK policy for cross-ownership references without an explicit architectural decision.