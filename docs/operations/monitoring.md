# Monitoring and Observability

This document defines the project-wide monitoring, logging and operational observability principles.

For the operational overview, see `overview.md`.

For deployment and rollback procedures, see `deployment.md`.

For security and sensitive logging rules, see `../security/overview.md`.

For system jobs, see `../jobs/overview.md`.

For external integrations, see `../architecture/integrations.md`.

## Purpose

Monitoring and observability exist to make production behavior understandable.

The system should provide enough information to determine:

- whether required services are operational;
- whether requests are failing;
- whether background jobs are progressing or failing;
- whether external providers are causing degraded behavior;
- which operation/request/job produced a failure;
- whether a deployment introduced a regression.

Observability must not compromise security or expose unnecessary sensitive information.

## Structured logging

Application and operational logs use structured logging.

The standard log levels are:

- `debug`;
- `info`;
- `warning`;
- `error`.

Use the level appropriate to the event rather than logging normal expected behavior as errors.

Logs should contain structured fields that allow relevant events to be searched and correlated.

Do not rely on free-form text alone when important operational context can be represented explicitly.

## Request correlation

Application requests should use a `requestId`.

The same `requestId` should be propagated across relevant internal processing boundaries where practical.

For Next.js ↔ FastAPI communication, preserve request correlation so that one logical request can be traced across both services.

Errors returned through the application's external error contract include:

`requestId`

This allows a client-visible failure to be correlated with internal logs without exposing internal diagnostic details.

Do not expose stack traces or sensitive internal information merely to improve client-side debugging.

## Service observability

Operational visibility should cover the main runtime components.

### `web/`

Relevant visibility may include:

- application startup;
- request failures;
- unexpected exceptions;
- database-related failures;
- authentication/authorization failures where operationally useful;
- FastAPI communication failures;
- important application operations.

### `ai-service/`

Relevant visibility may include:

- service startup;
- request failures;
- AI workflow failures;
- provider failures;
- database/vector-operation failures;
- validation/contract failures;
- internal service authentication failures.

### PostgreSQL

Database failures that affect application behavior must be observable through application/infrastructure diagnostics.

Do not log raw SQL, parameters or complete database records indiscriminately.

Database monitoring should focus on information required to understand availability and operational problems.

## Background jobs

Background/system jobs require explicit operational visibility.

A job must not fail silently.

Relevant job observability may include:

- job identity;
- job type;
- current stage/status;
- start/completion;
- failure;
- retry behavior;
- exhausted retries;
- relevant progress;
- duplicate/concurrency protection outcomes where diagnostically useful.

Persisted job state remains the authoritative execution state where the job architecture defines such state.

Logs complement persistent state; they do not replace it.

Detailed job architecture is documented in `../jobs/overview.md`.

## External providers

External provider failures should be distinguishable from internal application failures.

Relevant diagnostic context may include:

- provider;
- operation;
- response/failure category;
- timeout;
- rate-limit condition;
- retry attempt/exhaustion;
- associated job/request identity.

Do not log:

- provider credentials;
- authentication headers;
- API tokens;
- complete provider payloads without demonstrated need.

Temporary external provider failure should be observable even when the public application remains available using previously persisted data.

Detailed provider behavior is documented in `../architecture/integrations.md`.

## AI provider observability

AI operations may require additional operational context such as:

- provider;
- model where relevant;
- workflow/capability;
- request/job correlation;
- failure category;
- retry behavior;
- usage/cost metadata where supported and operationally useful.

Do not log complete prompts or model responses by default.

They may contain:

- imported copyrighted/source content;
- user data;
- internal instructions;
- sensitive application context.

Any future prompt/response logging requires an explicit policy defining what is retained, why it is required and how sensitive content is protected.

AI-provider architecture is documented in `../architecture/ai-service.md`.

## Health checks

Health checks provide machine-readable evidence that required services are able to perform their intended responsibility.

Potential health signals may cover:

- `web/` process/application availability;
- `ai-service/` process/application availability;
- required PostgreSQL connectivity;
- required internal service communication.

A process being alive does not necessarily mean the application is operationally healthy.

Health checks should distinguish between simple process/liveness checks and dependency/readiness checks when the implemented infrastructure requires that distinction.

Do not expose sensitive internal topology, credentials or detailed exception information through public health endpoints.

FastAPI health information remains inside the internal service boundary unless an explicit operational requirement defines otherwise.

Exact endpoints and contracts are documented in `deployment.md` once implemented.

## Deployment observability

Every deployment should remain traceable to a concrete repository version.

Operational diagnostics should make it possible to determine:

- which version is currently deployed;
- when deployment occurred;
- whether migrations succeeded;
- whether required services started successfully;
- whether post-deployment verification succeeded;
- whether failures began after a specific deployment.

Deployment logs must not expose secrets.

Detailed deployment rules are documented in `deployment.md`.

## Error visibility

Expected application errors and unexpected system failures are different operational categories.

Expected errors should be handled through the application's defined error model.

Unexpected failures should be logged with enough context to diagnose them while returning only safe information to clients.

Repeated unexpected failures should become visible through monitoring/alerting once the corresponding infrastructure exists.

Do not suppress unexpected exceptions merely to reduce log noise.

Likewise, do not generate excessive error-level noise for normal expected application behavior.

## Security events

Security-relevant failures may require operational visibility, including cases such as:

- repeated authentication failures;
- authorization failures;
- invalid service-to-service authentication;
- attempts to execute unauthorized privileged operations.

Logging security events must still follow data-minimization rules.

Do not log credentials, session secrets or unnecessary personal data.

The exact security-event monitoring policy is introduced when concrete security/operational requirements justify it.

## Metrics

Introduce metrics when they answer concrete operational questions.

Potential useful categories may eventually include:

- request rate and failure rate;
- request latency;
- job throughput/failure;
- queue/backlog size;
- provider failures;
- provider rate limiting;
- AI usage/cost;
- database health;
- deployment health.

These examples do not define a mandatory metrics platform or complete metric set.

Do not create large metric inventories merely because the monitoring tool supports them.

## Alerting

Alerts should represent conditions requiring attention or action.

Do not alert on every logged error.

Alerting should prioritize symptoms such as:

- service unavailable;
- sustained elevated failure rate;
- critical job repeatedly failing;
- processing backlog growing beyond acceptable limits;
- important external dependency degradation;
- failed production deployment;
- other conditions with meaningful operational impact.

Thresholds and alert destinations must be based on real production behavior and operational requirements.

Do not invent arbitrary thresholds before baseline behavior is known.

## Monitoring stack

No specific monitoring/observability vendor or platform is mandated yet.

Do not introduce:

- hosted monitoring services;
- metrics platforms;
- log aggregation infrastructure;
- tracing systems;
- alerting platforms;

without a demonstrated requirement and explicit architectural/operational decision.

The initial system may rely on simpler infrastructure-provided and application logging where that is sufficient.

The monitoring stack should evolve according to real operational needs.

## Retention

Log, metric and trace retention should be intentional.

Do not retain operational data indefinitely by default.

Retention policy should consider:

- diagnostic value;
- storage cost;
- security/privacy;
- operational requirements.

The concrete retention policy is defined when the production observability infrastructure exists.

## Production debugging

Production debugging must preserve normal security and operational boundaries.

Do not solve observability gaps by:

- enabling unrestricted verbose logging permanently;
- logging secrets;
- exposing internal services publicly;
- exposing stack traces to clients;
- dumping complete production database records;
- weakening authentication or authorization.

Temporary diagnostic changes that materially affect production behavior or security require explicit approval and should be removed/reverted when no longer required.

## Documentation

When concrete monitoring infrastructure is introduced, update this document with the actual operational model.

Document real:

- monitoring tools;
- log destinations;
- dashboards;
- metrics;
- alert rules;
- notification destinations;
- retention policies;
- operational procedures.

Do not document planned monitoring infrastructure as though it already exists.

If monitoring grows into several independent responsibilities, keep this file as the stable entry point and split detailed topics into additional files under `docs/operations/`.

## Open Questions

The following details remain intentionally open until real production operation establishes the requirements:

- monitoring/observability stack;
- centralized log storage;
- log retention policy;
- metrics platform;
- distributed tracing requirement;
- concrete metrics;
- alert thresholds;
- alert destinations;
- dashboards;
- AI usage/cost monitoring implementation;
- security-event monitoring policy;
- uptime/external availability monitoring;
- production incident-response process.

These decisions should be driven by actual operational needs rather than by introducing observability infrastructure speculatively.