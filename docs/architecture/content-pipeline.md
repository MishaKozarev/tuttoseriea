# Content Pipeline Architecture

This document defines the architecture for importing external editorial content and transforming it into drafts for editorial review.

For the overall system architecture, see `overview.md`.

For AI-service architecture, see `ai-service.md`.

For general external integration rules, see `integrations.md`.

For system job execution and concurrency rules, see `../jobs/overview.md`.

## Purpose

The content pipeline allows the project to consume material from multiple external content sources without coupling the shared processing pipeline to any particular source format or provider.

Sources may differ substantially in how content is discovered and retrieved.

Examples may include:

- HTML websites;
- RSS/Atom feeds;
- external APIs;
- other structured or semi-structured sources.

No source type, including RSS, is treated as the default architectural model.

## High-level flow

The canonical flow is:

    Source
        ↓
    source adapter
        ↓
      discovery
      fetch
      source-specific parsing/extraction
        ↓
    normalized source material
        ↓
    deduplication
        ↓
    queue
        ↓
    AI processing
        ↓
    draft
        ↓
    editor review

Everything before `normalized source material` is source-specific.

Everything after that boundary should be shared pipeline logic unless a concrete use case demonstrates the need for source-specific behavior.

## Source adapters

Each external content source is isolated behind a source adapter.

A source adapter owns the source-specific mechanics required to produce normalized source material.

This may include:

- discovering candidate materials;
- fetching source resources;
- understanding source-specific URLs or identifiers;
- parsing HTML/XML/JSON or another source representation;
- extracting the useful source content;
- extracting source metadata;
- determining the source-specific deduplication identity.

The shared pipeline must not need to understand whether the original material came from HTML, RSS, API or another format.

Source-specific parsing/extraction must not leak into the shared pipeline.

## Normalized source material

The output of a source adapter is a normalized source material representation.

At the architectural level, it contains three categories of information:

### Content

The material prepared for further processing.

The adapter is responsible for converting source-specific representation into a form suitable for the shared pipeline.

The shared pipeline should not need to parse the original provider-specific document format.

### Source metadata

Information required to understand and audit where the material came from.

This includes conceptually:

- source type;
- concrete source/feed;
- original URL or equivalent source reference.

Exact fields are not defined at the project-wide level yet.

### Dedup key

The adapter provides the identity used to determine whether the material has already been seen.

The semantics of uniqueness are source-specific.

Depending on the source, this may eventually be based on concepts such as:

- stable source identifier;
- feed GUID;
- canonical source URL;
- content-derived identity.

These are examples, not a prescribed algorithm.

The shared pipeline consumes the dedup key; it does not independently reconstruct source-specific uniqueness semantics.

## Deduplication

Deduplication occurs after the source adapter boundary and before a new material proceeds through the shared queue.

The goal is to prevent repeated discovery or polling of a source from creating duplicate logical processing work.

Deduplication must be safe under parallel execution.

Do not implement concurrency protection as:

`SELECT → check absence → separate INSERT`

when multiple workers/jobs may race.

Use atomic PostgreSQL coordination appropriate to the concrete implementation.

Detailed job concurrency rules are documented in `../jobs/overview.md`.

## Queue

Accepted normalized materials enter persistent processing state before expensive or multi-step processing continues.

The queue/state model exists to make processing:

- observable;
- retryable where appropriate;
- auditable;
- resumable after partial failure;
- independent from the lifetime of the discovery/fetch request.

The exact queue schema and status model are implementation details and are not fixed by this architecture document.

Legacy statuses or method names from the previous PHP implementation must not be treated as requirements for the new architecture.

## AI processing

AI processing operates on normalized content rather than directly on source-specific HTML, RSS or provider response structures.

The content workflow determines what AI processing is required.

Provider-specific AI SDK/API behavior remains behind the AI provider boundary defined in `ai-service.md`.

The content pipeline must not become coupled to one AI provider or model.

AI processing may prepare structured content and metadata required for a draft, but it does not authorize publication.

## Draft creation

Successful processing may produce a draft in the domain application.

Draft creation belongs to the application's editorial/domain boundary rather than to an external provider.

AI-generated or imported content remains non-public until the editorial workflow explicitly publishes it.

The exact draft schema and editorial fields belong to the concrete content/domain implementation and are not defined here.

## Editorial boundary

Publication is an editorial action.

The pipeline may:

- discover;
- fetch;
- normalize;
- deduplicate;
- process;
- create or prepare a draft.

It must not silently convert imported external material into published public content.

Bulk or automated publication requires a separate explicit architectural/product decision and the safeguards required for bulk operations.

## Failure handling

A failure in one source or one material must not unnecessarily block unrelated content processing.

Failures should preserve enough persisted state and diagnostic context to determine:

- which source/material failed;
- which processing stage failed;
- whether retry is appropriate;
- whether manual intervention is required.

External HTTP retry behavior follows `integrations.md`.

Job-level retry, idempotency and concurrency behavior follows `../jobs/overview.md`.

Do not create infinite retry loops.

## Source independence

Adding a new source should primarily require implementing its source-specific adapter.

It should not require rewriting the shared:

- deduplication model;
- queue orchestration;
- AI workflow architecture;
- draft/editorial boundary.

If adding a second real source reveals that the normalized contract contains assumptions specific to the first source, the contract should be generalized based on the demonstrated difference.

Do not attempt to predict every possible future source before this evidence exists.

## Legacy implementation

The previous SerieAlega implementation may be used as a source of architectural intent and lessons learned.

It must not be treated as the required implementation model for the new project.

In particular, the new architecture is not inherently tied to:

- Gazzetta;
- RSS;
- PHP-specific queue methods or statuses;
- the previous synchronous AI endpoint;
- the previous ownership boundary where the AI service stored no data.

Useful principles may be carried forward deliberately, while obsolete implementation assumptions should not be reproduced automatically.

## Open Questions

The following questions remain intentionally open until implementation of real sources provides enough evidence:

- exact normalized source material fields and types;
- exact source adapter interface;
- discovery execution model;
- source-specific error handling and retry responsibilities;
- exact dedup key representation;
- queue schema and processing statuses;
- first concrete source adapter for the new project;
- whether raw source payloads should be retained separately for audit/debugging;
- exact boundary between content workflow state owned by `web/` and AI-processing state owned by `ai-service/`.

These questions should be resolved from concrete implementation requirements rather than by designing a universal content ingestion framework in advance.