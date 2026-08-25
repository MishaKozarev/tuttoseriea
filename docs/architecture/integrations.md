# External Integrations Architecture

This document defines the architecture for external APIs and provider integrations.

For the overall system architecture, see `overview.md`.

For AI-provider architecture, see `ai-service.md`.

For content-source discovery and processing, see `content-pipeline.md`.

For system job execution and concurrency rules, see `../jobs/overview.md`.

## General principles

External providers are integration boundaries, not part of the core domain model.

Application/domain logic should not depend directly on:

- provider SDKs;
- provider-specific response objects;
- provider-specific status codes;
- provider-specific transport behavior.

Provider-specific behavior should be isolated behind integration code and normalized before it becomes internal application state where appropriate.

Normal public user-facing requests should not depend directly on external provider availability, latency or rate limits.

Where practical, external data is imported into persistent application state first and served from PostgreSQL.

## Football API

Football data follows an import-first model:

    Football API
        ↓
    scheduled/system job
        ↓
    PostgreSQL
        ↓
    public application

Public user-facing requests read football data from PostgreSQL.

Direct Football API calls from the public request path are prohibited by default.

A realtime external call from a user request is allowed only as an explicitly approved architectural exception for a concrete use case.

## Admin-triggered synchronization

Admin actions such as:

- update team players;
- refresh fixtures;
- synchronize coaches;
- refresh competition data;

must not turn the admin HTTP request into a long-running direct provider call.

The expected model is:

    admin action
        ↓
    system job
        ↓
    Football API
        ↓
    PostgreSQL
        ↓
    tracked job result

This preserves the same integration boundary for scheduled and manually triggered synchronization.

## Provider status normalization

Provider-specific statuses must not automatically become internal domain concepts.

Internal application state should use project-owned semantics where the provider contract requires normalization.

A provider status may map to an internal state or behavior without exposing the original provider code throughout the application.

This is especially important for match lifecycle logic.

## Match freshness / polling

Match polling is controlled by internal polling categories rather than raw provider status codes.

The three architectural polling categories are:

- `ACTIVE` — frequent polling;
- `WATCH` — infrequent control polling;
- `TERMINAL` — no further polling required.

The exact mapping of provider statuses to internal match states and polling categories is intentionally not fixed until the concrete Football API contract is confirmed.

Possible internal match states may include:

- `scheduled`;
- `live`;
- `postponed`;
- `suspended`;
- `finished`;
- `cancelled`.

These examples do not define the final state model.

Polling frequency and acceptable staleness are also provider/use-case specific and must not be hardcoded as project-wide rules before the provider contract is known.

Regardless of polling category, the public application reads match state from PostgreSQL.

## Timeouts

Every external HTTP request must use an explicit timeout.

Do not rely on library defaults as the intentional timeout policy.

Concrete timeout values are provider-specific and belong to the corresponding integration configuration.

## Retry policy

Retry is only appropriate for transient failures.

Typical retryable cases include:

- connection failures;
- network failures;
- request timeouts;
- HTTP `429`;
- HTTP `502`;
- HTTP `503`;
- HTTP `504`.

Do not automatically retry:

- validation errors;
- authentication/authorization failures such as `401` or `403`;
- most other `4xx` responses that indicate a non-transient request problem.

Retries must be bounded.

Use exponential backoff with jitter.

If the provider returns `Retry-After`, respect it instead of using arbitrary waiting logic.

Infinite retry loops are prohibited.

When retries are exhausted:

- the current operation/job records the failure appropriately;
- the error is logged;
- execution does not wait indefinitely.

## Rate limits

Rate-limit handling should be centralized at the integration/job level.

Do not scatter arbitrary `sleep()` calls throughout provider-specific code.

Provider-specific rate-limit information, such as headers or documented quotas, should be handled by the integration policy for that provider.

The architecture should adapt polling/import frequency to provider limits rather than creating uncontrolled pressure on the external service.

## Provider failure behavior

External provider failure must not automatically make the public site unavailable.

For imported football data, the public application continues to read the last successfully persisted state from PostgreSQL.

Provider failure affects data freshness, not the basic availability of already stored public data.

The UI may expose freshness/state information later if a concrete product requirement requires it; this is not a current universal requirement.

## External caching

Do not introduce a separate persistent cache layer for Football API responses by default.

PostgreSQL is the persistent buffer between the provider and the public application.

A short-lived in-memory cache or deduplication structure is allowed inside a single job execution when it prevents duplicate requests during that run.

Such in-memory state:

- exists only for the lifetime of the current process/job;
- does not survive between job runs;
- is not a shared cache layer.

Redis or another shared cache is introduced only after a demonstrated need.

Next.js/CDN caching of already persisted application data is a separate concern and does not change this integration policy.

## Idempotency boundary

HTTP GET requests to a read-only Football API are naturally idempotent at the provider-call level.

However, retrying or restarting a job may repeat database writes after partial progress.

Therefore, job-level idempotency is handled separately from HTTP retry behavior.

Detailed job idempotency, progress and concurrency rules are defined in:

`../jobs/overview.md`

## Integration code boundaries

Provider-specific integration code should have a clear responsibility:

- construct provider requests;
- apply provider authentication/configuration;
- execute HTTP calls;
- handle timeout/retry/rate-limit policy;
- normalize provider-specific responses/errors.

It should not own unrelated domain/business logic.

Conversely, domain/application code should not contain provider SDK calls or provider-specific transport handling.

## Observability

External integration failures must use the project's structured logging conventions.

Logs should provide enough context to diagnose:

- provider;
- operation;
- job/request correlation;
- failure category;
- retry exhaustion where applicable.

Do not log provider credentials, tokens or unnecessarily large/raw provider payloads.

Sensitive logging rules are defined in `../security/overview.md`.

## Open Questions

The following integration questions remain intentionally open until real provider contracts and usage patterns are known:

- concrete Football API provider and plan;
- exact provider status → internal match state mapping;
- exact internal match state model;
- polling intervals for `ACTIVE` and `WATCH`;
- acceptable staleness for live match data;
- provider-specific timeout values;
- provider-specific retry limits;
- provider-specific rate-limit configuration;
- whether any concrete use case justifies a realtime provider call from a user request;
- whether a shared cache such as Redis is ever required.

Do not turn these questions into project-wide defaults without an explicit decision.