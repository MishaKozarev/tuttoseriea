# System Jobs

This document defines the architecture and execution rules for background, scheduled and system jobs.

For overall architecture, see `../architecture/overview.md`.

For external integration rules, see `../architecture/integrations.md`.

For database and transaction rules, see `../architecture/database.md`.

For testing rules, see `../testing/overview.md`.

## Purpose

System jobs execute work that should not be performed directly inside normal user-facing HTTP requests.

Typical responsibilities may include:

- Football API synchronization;
- content discovery/import;
- AI processing;
- scheduled maintenance;
- backfills;
- reindexing;
- other asynchronous or potentially long-running operations.

Jobs may be started by a schedule, an administrative action or another internal workflow.

The trigger does not change the job's safety requirements.

## General model

The expected pattern is:

    trigger
        ↓
    persistent job state
        ↓
    atomic claim
        ↓
    processing
        ↓
    persisted progress/result
        ↓
    completed / failed

Long-running or externally dependent work should not rely solely on the lifetime of an HTTP request.

Where work has meaningful execution state, that state should be persisted so the operation can be observed and diagnosed.

## Job identity and state

Jobs that require persistent execution tracking have a stable job identity.

The general lifecycle may include states such as:

- `pending`;
- `running`;
- `completed`;
- `failed`.

Additional states should be introduced only when a concrete workflow requires them.

Do not create a universal complex state machine for hypothetical future jobs.

Job records should preserve enough information to determine:

- what operation was requested;
- current execution state;
- whether it completed or failed;
- relevant progress where required;
- diagnostic information appropriate for troubleshooting.

## Idempotency

System jobs must be designed so retrying or restarting an operation does not unintentionally duplicate logical work.

Where the job represents a logically unique operation, use an idempotency key appropriate to that job type.

The semantics of the key are job-specific.

Examples may include identity based on:

- operation type;
- target entity;
- provider/source;
- time window;
- source material identity;
- another stable domain-specific key.

These are examples, not a universal key format.

Idempotency must be enforced at the persistence/coordination boundary where concurrency can actually occur.

Application-level assumptions alone are insufficient.

## Parallel execution protection

Two workers or triggers must not be able to claim the same logically exclusive work merely because they checked state at nearly the same time.

Do not use:

`SELECT → check absence → separate INSERT`

as concurrency protection.

The claim must use an atomic PostgreSQL mechanism.

Depending on the concrete job, this may use mechanisms such as:

- a unique constraint combined with an atomic insert;
- `INSERT ... ON CONFLICT`;
- row-level locking;
- PostgreSQL advisory locking;
- another PostgreSQL mechanism that provides the required atomic guarantee.

The concrete mechanism is selected according to the job's actual coordination requirements.

Do not introduce Redis or another coordination system merely to solve a problem PostgreSQL already handles adequately.

## Transactions and progress

Keep database transactions short.

Do not keep a database transaction open while waiting for:

- external HTTP APIs;
- AI providers;
- long-running processing;
- user interaction;
- other slow external work.

For multi-step jobs, persist meaningful progress between steps where required.

A failure after partial progress should not automatically require restarting all completed work when the workflow can safely resume.

The exact progress model is job-specific.

## External calls

Jobs calling external providers follow the timeout, retry, backoff and rate-limit rules defined in:

`../architecture/integrations.md`

HTTP retry and job retry are different concerns.

A provider request may be safe to retry while the complete job still requires additional idempotency protection around database side effects.

Do not assume that an idempotent external GET request makes the entire job idempotent.

## Failure behavior

A failed job should move to an observable failure state rather than remaining indefinitely `running`.

Failure information should allow diagnosis without exposing secrets.

A job failure should not silently disappear.

Do not implement infinite automatic retry loops.

Retry behavior must distinguish between:

- transient failures that may succeed later;
- permanent/validation/configuration failures that require intervention.

The exact job-level retry policy may differ by job type.

## Scheduled jobs

Scheduled execution must use the same idempotency and concurrency protections as manually triggered execution.

A delayed or overlapping scheduler invocation must not create duplicate logical processing.

Do not assume scheduler timing itself prevents overlap.

## Admin-triggered jobs

An administrative HTTP action that requests long-running or external work should normally create/trigger a job rather than execute the complete operation synchronously inside the request.

The admin action should be able to receive a tracked result/state appropriate to the operation.

Authorization to trigger a job does not automatically authorize every possible scope of bulk execution.

Security rules are documented in `../security/overview.md`.

## Bulk and side-effect operations

Implementing a bulk operation does not authorize executing it.

Examples include:

- historical imports;
- backfills;
- reindexing;
- mass AI processing;
- mass data changes;
- mass publication;
- mass creation of indexable pages;
- other operations with significant cost or side effects.

Execution requires separate explicit user approval according to root `AGENTS.md`.

Before execution, state:

- what operation will run;
- what data/scope it will affect;
- expected scale where it can be determined;
- important external cost/side effects where relevant.

Development/testing must not silently trigger real bulk operations.

## Logging and observability

Jobs use structured logging.

Relevant job logs should include enough context to correlate events, such as:

- job identity;
- job type;
- execution stage;
- relevant target/source identifiers;
- failure category.

Do not log:

- secrets;
- credentials;
- authentication tokens;
- unnecessary full external payloads;
- sensitive data without demonstrated diagnostic need.

Detailed security/logging rules are documented in `../security/overview.md`.

## Testing

Concurrency-sensitive and idempotency-sensitive job behavior requires appropriate tests.

Important scenarios include:

- running the same logical job more than once;
- simultaneous attempts to claim the same work;
- failure after partial progress;
- restart/retry behavior;
- duplicate external discovery/input;
- safe handling of exhausted retries.

Do not rely only on unit mocks when the behavior being protected depends on PostgreSQL atomicity or transaction semantics.

Detailed testing strategy is documented in `../testing/overview.md`.

## Implementation principle

Do not choose a heavyweight queue or orchestration platform before the project demonstrates the need for one.

The initial architecture may use PostgreSQL-backed coordination and ordinary scheduled/CLI execution where sufficient.

If future scale or workflow requirements demonstrate that a dedicated job system is needed, it should be introduced through an explicit architectural decision rather than silently replacing the existing coordination model.

## Open Questions

The following details remain intentionally open until concrete jobs require them:

- concrete scheduler mechanism;
- whether a dedicated queue/worker framework is needed;
- exact job table/schema;
- exact job status model beyond the basic lifecycle;
- idempotency-key format for each job type;
- atomic coordination mechanism for each job type;
- job-level retry limits and delay policy;
- progress/checkpoint representation;
- job retention/history policy;
- whether future scale requires coordination infrastructure beyond PostgreSQL.

These questions must be resolved from concrete operational requirements rather than by designing a universal job platform in advance.