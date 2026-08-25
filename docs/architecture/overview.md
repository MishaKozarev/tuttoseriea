# Architecture Overview

This directory contains the architecture documentation for the project.

Root `AGENTS.md` defines the mandatory architectural invariants that Codex must always follow. This documentation explains the architecture in more detail and routes work to the relevant architecture document.

## System overview

The project is a Russian-language platform focused on Italian football, with Serie A as its initial and primary product scope.

The main runtime components are:

- `web/` — Next.js public website, admin panel and domain application;
- `ai-service/` — internal Python/FastAPI service for AI/vector workflows;
- PostgreSQL + pgvector — shared physical database;
- external football, content and AI providers;
- background/system jobs.

The high-level data flow follows one central principle:

**External providers feed persistent application state; normal user-facing requests read the application's own state instead of depending directly on external providers.**

This keeps the public application independent from temporary provider outages, rate limits and response latency.

## Service boundaries

### `web/`

`web/` owns the main domain application. Domain ownership inside `web/` is divided between
the bounded contexts defined in `domain-model.md`.

The confirmed domain boundaries inside `web/` are defined in `domain-model.md`.

Administrative functionality is a management/access surface over these domains rather than
a domain owner itself.

Business/domain logic should remain outside React components and HTTP boundaries.

### `ai-service/`

`ai-service/` owns the implementation of AI/vector-specific workflows and AI-specific technical
data. It does not own the business domain data of `web/`.

It is designed as an extensible AI service rather than a service for one specific AI feature.

AI workflow/domain logic must not be coupled directly to a specific AI provider, model or SDK.

In staging and production, FastAPI is an internal-only service.

### Service communication

Next.js ↔ FastAPI communication uses an explicit HTTP/API boundary.

FastAPI does not directly read or modify domain tables owned by `web/`.

When an AI workflow needs domain data owned by `web/`, it crosses the defined service boundary rather than bypassing ownership through direct database access.

FastAPI OpenAPI is the source of truth for the FastAPI API contract.

## Data architecture

PostgreSQL + pgvector form one shared physical database, while data ownership remains logically separated between services.

Drizzle is the single source of truth and migration authority for the entire PostgreSQL schema, including AI/vector tables.

A second independent migration authority such as Alembic is not used.

Detailed database ownership, schema and migration rules:

See `database.md`.

## AI architecture

The AI service may support different workflows over time, including content processing, embeddings, retrieval/RAG, chat and other future AI functionality.

Provider-specific implementation remains behind integration boundaries.

AI capabilities and abstractions are introduced when real use cases require them rather than designing a universal AI interface in advance.

Detailed AI-service architecture:

See `ai-service.md`.

## External integrations

External providers are treated as integration boundaries rather than as part of the core domain model.

This includes, among others:

- Football API providers;
- AI providers;
- other external APIs and data sources.

Public user-facing requests do not call Football API directly.

External football data is imported into PostgreSQL through background/system processing and is then read by the application from its own persistent state.

Provider-specific statuses, schemas and behavior must be normalized before they become internal application concepts where appropriate.

Detailed integration architecture:

See `integrations.md`.

System job execution, idempotency and concurrency rules are documented separately:

See `../jobs/overview.md`.

## Content pipeline

The content architecture supports multiple external content sources.

Source-specific discovery, fetching and parsing/extraction are isolated behind source adapters.

Adapters produce normalized source material before content enters the shared processing pipeline.

The shared pipeline must not depend on whether the original material came from HTML, RSS, API or another source-specific format.

AI processing prepares content for editorial review; it does not independently authorize publication.

Detailed content-source and content-pipeline architecture:

See `content-pipeline.md`.

## Architecture principles

Across all architecture areas:

- preserve explicit ownership and service boundaries;
- keep provider-specific behavior behind integration boundaries;
- prefer persistent application state over runtime dependency on external providers;
- do not introduce infrastructure or architectural layers without demonstrated need;
- do not create abstractions before they have a real responsibility;
- keep business/domain logic separate from transport, UI and provider-specific implementation;
- prefer simple architecture that can evolve when a real use case demonstrates the need.

## Related documentation

For confirmed domain bounded contexts:

See `domain-model.md`.

For development environment and local setup:

See `../development/overview.md`.

For testing strategy:

See `../testing/overview.md`.

For system jobs and background operations:

See `../jobs/overview.md`.

For security boundaries:

See `../security/overview.md`.

For SEO/indexing architecture:

See `../seo/overview.md`.

For deployment and operations:

See `../operations/overview.md`.

## Open Questions

The following architecture questions are intentionally not resolved at the project-wide level yet:

- FK vs logical references between AI/vector data and domain entities;
- concrete Football API provider statuses and their mapping to internal match states;
- polling intervals and acceptable staleness for live football data;
- concrete AI capability contracts;
- exact normalized source material schema;
- exact source adapter interfaces;
- introduction of Redis or another shared cache/coordination layer if a demonstrated need appears.

These questions must remain open until a concrete use case and explicit architectural decision resolve them.