# AI Service Architecture

This document defines the architectural boundaries and long-term principles of `ai-service/`.

For the overall system architecture, see `overview.md`.

For database ownership and migration rules, see `database.md`.

## Purpose

`ai-service/` is the internal Python/FastAPI service responsible for AI/vector-specific workflows.

It is not designed around one specific feature.

The service may support different AI-related use cases over time, including:

- content processing and translation;
- embeddings;
- vector search;
- retrieval/RAG;
- AI chat;
- other AI workflows introduced by real product requirements.

The architecture must allow these responsibilities to evolve without coupling the service to one current workflow, AI provider, model or SDK.

At the same time, abstractions for hypothetical future capabilities must not be designed before a real use case requires them.

## Service boundary

In staging and production, FastAPI is an internal-only service.

The browser does not call FastAPI directly.

Communication with `web/` goes through an explicit Next.js ↔ FastAPI HTTP/API boundary.

FastAPI OpenAPI is the source of truth for this API contract.

TypeScript boundary types used by `web/` are generated from OpenAPI with `openapi-typescript`.

FastAPI does not directly read or modify domain tables owned by `web/`.

When an AI workflow needs domain data owned by `web/`, it obtains that data through the defined service boundary.

Database ownership and migration rules are defined in `database.md`.

## Internal responsibilities

The FastAPI HTTP layer is responsible for transport concerns such as:

- request validation;
- response validation;
- authentication of service-to-service requests;
- mapping HTTP schemas to internal application/workflow models;
- mapping application errors to the external API error contract.

AI workflows own the actual AI-related orchestration and business behavior.

Provider adapters own communication with external AI providers.

These responsibilities must remain separate.

## Error boundary

FastAPI workflow/domain logic must not depend on `HTTPException`.

Internal layers use application-level errors appropriate to the operation, for example:

- validation errors;
- not-found errors;
- conflict errors;
- external-service errors.

The HTTP boundary maps these errors to HTTP responses.

Contract validation errors must also be normalized to the project's external error contract rather than exposing FastAPI's native response format.

External application errors use:

`{ error: { code, message, requestId } }`

Unexpected exceptions are logged server-side with the relevant `requestId`, while clients receive only a safe internal-error response.

HTTP serialization logic should remain centralized so different exception handlers do not independently evolve incompatible response shapes.

## AI provider independence

Workflow/domain logic must not directly depend on a specific:

- AI provider;
- model;
- provider SDK;
- provider-specific request/response structure.

The conceptual dependency direction is:

    AI workflow
        ↓
    internal capability/provider boundary
        ↓
    provider adapter
        ↓
    external AI API

Provider-specific behavior belongs behind the integration boundary.

Switching or adding an AI provider should not require rewriting unrelated workflow/domain logic.

## Workflow vs provider responsibility

A provider adapter answers the technical question:

**How is a particular AI capability executed through this provider?**

A workflow answers the product/domain question:

**What AI operations does this use case require and how are they orchestrated?**

Prompts belong to workflow/domain logic, not to provider adapters.

Provider adapters must not become owners of football, editorial or other product-specific business rules.

Likewise, workflows should not contain provider SDK calls or provider-specific transport handling.

## Capability model

Do not create one universal AI provider interface containing every possible AI function.

Capabilities should be introduced as narrow contracts when real use cases require them.

Possible future capabilities may include, for example:

- text generation;
- embeddings;
- chat;
- tool execution;
- other provider-supported primitives.

These examples do not define mandatory interfaces today.

A concrete provider adapter may implement several capabilities.

Another provider may implement only a subset.

Workflows depend on the capability they need rather than on a provider brand.

Capability availability and configuration must become explicit when concrete capabilities/providers are implemented.

## RAG / retrieval

RAG is application orchestration, not a single provider capability.

The project may own responsibilities such as:

- chunking;
- embedding orchestration;
- vector storage;
- retrieval;
- ranking;
- context construction;
- generation orchestration.

Provider capabilities such as embeddings and generation are technical primitives used by this workflow.

Do not couple the architecture to a provider-specific "RAG as a service" abstraction when doing so would unnecessarily transfer application orchestration and data ownership to that provider.

The exact RAG architecture is not defined until a real RAG use case is implemented.

## AI/vector data

`ai-service/` owns AI/vector-specific data, which may include:

- embeddings;
- AI processing state;
- AI jobs;
- retrieval metadata;
- other AI-specific persisted state.

FastAPI may access data within this ownership boundary directly through PostgreSQL.

Drizzle remains the single migration authority for these tables even though FastAPI owns their application responsibility.

Detailed rules are defined in `database.md`.

## Testing and external providers

Automated tests must not depend on real paid AI calls by default.

Provider boundaries should allow fake/test implementations where needed.

Real provider usage requires explicit opt-in according to the development/testing rules.

This allows workflows to be tested independently from:

- provider availability;
- API credentials;
- rate limits;
- network behavior;
- monetary cost.

Detailed testing rules are documented in `../testing/overview.md`.

## Extensibility principle

The service should evolve by adding real responsibilities, not by predicting every future AI feature.

When a new AI use case appears:

1. determine the workflow responsibility;
2. identify which technical AI capabilities it actually requires;
3. reuse an existing capability boundary when it genuinely fits;
4. introduce a new narrow capability only when necessary;
5. keep provider-specific implementation behind an adapter.

Do not generalize an abstraction solely because a future provider or feature might theoretically need it.

## Open Questions

The following questions are intentionally unresolved until concrete use cases require decisions:

- exact AI capability interfaces;
- which AI providers will be supported;
- provider selection/configuration strategy for each capability;
- concrete model selection;
- streaming architecture;
- tool-use/tool-execution contracts;
- detailed RAG/retrieval architecture;
- concrete embedding and vector-search strategy.

These questions must not be resolved as project-wide architecture implicitly during implementation of an unrelated feature.