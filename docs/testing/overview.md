# Testing Overview

This document defines the testing strategy and mandatory verification principles for the project.

For development environment and LOCAL setup, see `../development/overview.md`.

For architecture and service boundaries, see `../architecture/overview.md`.

For Git/CI workflow, see `../git-workflow.md`.

## Purpose

Testing protects critical business logic, service contracts and important user flows.

The goal is not 100% code coverage.

Tests should provide confidence proportional to the risk and responsibility of the changed code.

The project uses four verification levels:

- Unit;
- Integration;
- E2E;
- Smoke.

Not every change requires every level.

The required verification depends on what the change can break.

## Test stack

The primary test stack is:

- Next.js unit/component tests — Vitest + React Testing Library;
- FastAPI tests — pytest;
- browser E2E tests — Playwright.

Do not introduce another overlapping test framework without demonstrated need.

## Unit tests

Unit tests protect isolated business/application logic.

Typical candidates include:

- domain rules;
- transformations;
- normalization;
- validation;
- mapping logic;
- deterministic calculations;
- job decision logic;
- other logic that can be tested without exercising complete system boundaries.

Do not create unit tests merely to increase coverage numbers.

## Component tests

React component tests use Vitest + React Testing Library where component behavior benefits from isolated verification.

Prefer testing observable behavior rather than implementation details.

Do not make component tests responsible for validating complete application flows that are better protected by integration or E2E tests.

## Integration tests

Integration tests protect boundaries between real project components.

Important integration areas include:

- application/service ↔ PostgreSQL;
- Drizzle schema/migration behavior where relevant;
- Next.js ↔ FastAPI;
- provider adapters ↔ normalized internal contracts;
- system job coordination and persistence.

Integration tests should verify contracts and behavior that mocks alone cannot reliably protect.

## Next.js ↔ FastAPI contract

The Next.js ↔ FastAPI boundary requires explicit integration protection.

FastAPI OpenAPI is the source of truth for the FastAPI HTTP contract.

TypeScript boundary types are generated using `openapi-typescript`.

Tests/checks must protect against accidental contract drift between services.

This includes relevant changes to:

- request schemas;
- response schemas;
- error responses;
- required fields;
- status behavior used across the boundary.

The shared external application error shape is:

`{ error: { code, message, requestId } }`

Do not maintain a manually duplicated TypeScript API contract when it can be generated from FastAPI OpenAPI.

## E2E tests

Playwright protects critical user-visible flows that require the application to work across multiple layers.

E2E coverage should focus on important workflows rather than attempting to reproduce every possible UI interaction.

Examples may include:

- authentication;
- important public navigation;
- admin workflows;
- content/editorial workflows;
- other critical end-to-end product behavior.

The exact E2E suite evolves with implemented features.

## Smoke tests

Smoke tests verify that a deployed or production-like system is fundamentally operational.

Depending on the environment, smoke verification may include:

- application availability;
- critical health endpoints;
- basic database connectivity through the application;
- required internal service communication;
- one or more critical read paths.

Smoke tests are not a substitute for Unit, Integration or E2E tests.

Production smoke checks must avoid destructive or uncontrolled side effects.

## External providers

Automated tests do not call real paid or limited external providers by default.

Use:

- fixtures;
- mocks;
- fakes;
- controlled test implementations;

according to the boundary being tested.

This applies especially to:

- AI providers;
- Football API;
- external content sources;
- other quota-limited or side-effecting services.

A real provider may be used only through an explicit opt-in verification scenario.

Tests must not silently consume money or provider quota.

## Database tests

Tests that require persistent database behavior must use controlled test data and isolation appropriate to the test level.

Tests must not depend on:

- execution order of unrelated tests;
- leftover state from another test;
- the developer's arbitrary LOCAL database contents.

Test data should be deterministic where practical.

A test environment must not destructively reset the developer's normal LOCAL database as an implicit testing mechanism.

Detailed database architecture is documented in `../architecture/database.md`.

## Jobs

Job behavior that can create duplicate processing or conflicting state requires appropriate verification.

Important cases include:

- idempotent re-execution;
- duplicate parallel execution;
- atomic claim/coordination behavior;
- partial progress and restart behavior where relevant;
- safe failure behavior.

Detailed job rules are documented in `../jobs/overview.md`.

## Selecting required tests

Verification is selected according to change risk.

As a general rule:

- isolated logic change → relevant Unit tests;
- database or service-boundary change → relevant Integration tests;
- critical user-flow change → relevant E2E tests;
- deployment/runtime change → relevant Smoke and production-like verification.

A change may require several levels.

Security-sensitive, contract-sensitive, migration-sensitive and concurrency-sensitive changes require stronger verification than ordinary presentation-only changes.

Do not reduce required verification merely because a broader test is slower or more difficult to implement.

## Missing verification tooling

If a verification level required by the change does not yet exist or cannot be executed:

- report the gap explicitly;
- do not claim the check passed;
- do not silently substitute a weaker check and describe it as equivalent.

Do not cross a control gate for which that verification is mandatory unless:

- the missing verification capability is implemented; or
- the user makes a separate explicit decision to proceed despite the gap.

## LOCAL verification

Automated tests do not replace the manual LOCAL gate defined in root `AGENTS.md`.

After implementation and relevant automated checks, Codex provides the manual verification scenario and waits for:

`LOCAL OK`

Automated success alone does not authorize commit/push/PR progression.

## CI

CI runs the checks required by the repository for the affected change.

Required CI must pass before merge to `main`.

Do not:

- bypass required CI;
- disable a failing required test merely to merge;
- report a skipped required check as successful.

The exact CI workflow and commands must correspond to the actual repository configuration.

Git workflow rules are documented in `../git-workflow.md`.

## Test maintenance

Tests are production code quality responsibilities.

When behavior intentionally changes:

- update tests that protect the changed contract or behavior;
- remove obsolete tests when their protected behavior genuinely no longer exists;
- do not weaken assertions merely to make a changed implementation pass.

Avoid tests that are tightly coupled to irrelevant implementation details.

Prefer stable behavior and contract assertions.

## Open Questions

The following details remain open until concrete repository tooling and features establish them:

- exact test commands;
- exact test database strategy and lifecycle;
- exact CI test matrix;
- initial set of critical Playwright flows;
- exact production smoke-test implementation;
- coverage reporting/thresholds, if any are ever demonstrated to be useful.

These details must be established from real project needs rather than by targeting arbitrary test metrics.