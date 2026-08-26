# Security Overview

This document defines the project-wide security boundaries and mandatory security principles.

For overall architecture, see `../architecture/overview.md`.

For domain roles, permissions, account ownership and object-level authorization rules, see `../architecture/domain-model.md`.

For database ownership, see `../architecture/database.md`.

For development and environment configuration, see `../development/overview.md`.

For system and bulk operations, see `../jobs/overview.md`.

For deployment and operations, see `../operations/overview.md`.

## Security principle

Security controls are part of application architecture and must not be weakened for implementation convenience.

When a feature conflicts with an existing authentication, authorization, data-protection or infrastructure boundary, do not bypass the boundary merely to make the feature work.

If a real requirement needs the boundary to change, treat that as an explicit architectural/security decision.

## Authentication

Auth.js is the authentication layer for `web/`.

The project uses database-backed sessions.

PostgreSQL is authoritative for session state, account state and assigned roles.

Authentication decisions must be performed server-side.

Do not rely on client-side state as proof that a user is authenticated.

Client-side authentication state may be used for presentation, but sensitive server operations must independently enforce authentication.

## Authorization

Authorization is enforced server-side.

The confirmed role and permission model is defined in `../architecture/domain-model.md`.

The current staff roles are:

* `writer`;
* `admin`;
* `super_admin`.

Public registration creates an `Account` without staff roles.

Do not use boolean fields such as `is_admin` as a substitute for the defined role/permission model.

Do not treat hiding UI controls as authorization.

Every protected server-side operation must verify the authorization required for that operation.

Role-based authorization alone is not sufficient where the domain defines object-level authorization.

For example, a writer may edit an article only when:

`Article.author_account_id = current_account.id`

This ownership rule must be enforced server-side independently of the writer's role.

Authorization belongs at the appropriate server/application boundary rather than being scattered through client components.

## Staff access and invitations

Staff access uses the invitation model defined in `../architecture/domain-model.md`.

There is exactly one `Account` per person.

A staff invitation either:

* attaches the appropriate staff role to an existing `Account` matched by email; or
* creates a new `Account` for the invited person.

There is no independent admin/staff account system and no separate unrestricted admin registration flow.

An admin-facing registration screen, where required, represents invitation acceptance rather than independent signup.

Authorization to create invitations must itself be enforced server-side according to the permissions of the acting account.

## Admin access

Administrative functionality requires authenticated server-side authorization.

Administrative access must follow the roles, permissions and object-level rules defined by the domain model.

Do not assume that access to an admin-facing route grants unrestricted access to every administrative operation.

Where the domain defines narrower ownership or permission rules, those rules must also be enforced.

Do not introduce additional roles, permissions or unrelated boolean permission flags without a concrete product requirement and explicit domain/security decision.

## Admin operation risk

Administrative operations should be protected according to their risk.

The project distinguishes conceptually between:

### Normal CRUD

Ordinary synchronous operations with limited scope.

Examples may include editing one entity or changing ordinary metadata.

### Significant operations

Operations with broader scope, external cost or meaningful side effects.

Examples may include:

* provider synchronization;
* bulk processing;
* reindexing;
* significant AI processing;
* operations affecting many entities.

These require safeguards appropriate to the operation, including explicit scope and confirmation where needed.

### Destructive operations

Operations capable of deleting, irreversibly replacing or materially damaging data/state.

These require stronger explicit confirmation and appropriate auditability.

The exact confirmation UX is defined by the concrete feature.

Implementing an administrative operation does not authorize Codex to execute it.

Bulk execution rules are documented in `../jobs/overview.md` and root `AGENTS.md`.

## Next.js security boundary

Sensitive operations must execute server-side.

Route Handlers and appropriate server-side application layers enforce authentication and authorization before protected actions are performed.

Server Actions may be used where appropriate, but their existence does not remove the requirement for server-side authorization.

Do not trust data merely because it originated from the project's own browser UI.

All externally supplied input must cross an appropriate validation boundary.

## `proxy.ts`

`proxy.ts` may be used for routing/access-related concerns where appropriate, but it is not the mandatory or sole authorization layer.

Do not move DB-backed authorization into `proxy.ts` merely to centralize access checks.

Protected operations must still enforce authorization at the server/application boundary where the operation actually occurs.

## FastAPI boundary

In staging and production, FastAPI is internal-only.

It must not be exposed as a public browser-facing API unless an explicit architectural decision changes this boundary.

Next.js ↔ FastAPI communication requires service-to-service authentication.

The shared internal secret/API credential is supplied through server-side environment configuration.

It must never be exposed to:

* browser/client bundles;
* public runtime configuration;
* logs;
* repository history.

Network isolation is an additional protection and does not replace service-to-service authentication.

## Secrets

Secrets must never be committed to Git.

This includes:

* API keys;
* access tokens;
* passwords;
* service-to-service credentials;
* database credentials;
* signing/authentication secrets;
* other private provider credentials.

Real secrets belong in environment configuration or the deployment secret mechanism appropriate to the environment.

`.env.example` files contain variable names and safe examples only.

Do not place secrets in client-accessible environment variables.

Do not solve configuration problems by hardcoding credentials temporarily into source code.

## Logging

The project uses structured logging.

Logs should provide enough context to diagnose failures while avoiding unnecessary sensitive information.

Relevant logs may include:

* `requestId`;
* job identity;
* operation;
* error category;
* non-sensitive entity/source identifiers;
* relevant execution stage.

Do not log:

* passwords;
* API keys;
* access tokens;
* session secrets;
* service-to-service credentials;
* full authentication headers;
* other credentials.

Do not log complete external/provider payloads merely for convenience.

Log only the information actually required for diagnosis.

## Personal and sensitive data

Do not expose personal or sensitive data through logs, errors or public API responses without a concrete product requirement.

When such data must be processed, minimize its propagation between layers and services.

Error responses must not expose:

* stack traces;
* SQL errors;
* filesystem paths;
* internal credentials;
* internal implementation details;
* unnecessary user/private data.

Unexpected exceptions are logged internally and mapped to safe external errors.

The common application error contract is documented in `../architecture/overview.md`.

## Untrusted content

Treat external and user-supplied content as untrusted.

Do not render untrusted HTML directly without an explicit sanitization policy.

This applies to content originating from sources such as:

* external editorial sources;
* imported HTML;
* user-generated content;
* AI-generated content containing markup;
* external provider responses.

Escaping/sanitization must occur at the appropriate boundary for the concrete rendering model.

The exact sanitization library or implementation is intentionally not fixed until a feature requires HTML rendering.

Introducing such a policy is a security-relevant implementation decision and must be explicitly designed for the concrete use case.

## AI security boundary

AI-generated output is untrusted application input.

Do not assume that structured or textual output from an AI provider is safe merely because the request originated from the application.

Validate AI output before using it for operations that require structured data or domain constraints.

AI output must not independently authorize:

* publication;
* destructive actions;
* privileged operations;
* security decisions.

AI provider credentials follow the same secret-handling rules as other external integrations.

Detailed AI architecture is documented in `../architecture/ai-service.md`.

## External integrations

External providers are untrusted network boundaries.

Use explicit:

* authentication/configuration;
* timeout behavior;
* validation/normalization;
* safe error handling.

Do not expose raw provider errors directly to public clients.

Provider-specific integration rules are documented in `../architecture/integrations.md`.

## Database security

Application code should use the minimum database access appropriate to its responsibility.

Service ownership boundaries defined in `../architecture/database.md` must not be bypassed merely because both services share one physical PostgreSQL database.

In particular:

* `web/` owns domain data;
* `ai-service/` owns AI/vector-specific data;
* FastAPI does not directly read or modify domain tables owned by `web/`.

A shared database is not permission to bypass the service boundary.

## Security-sensitive changes

Treat a change as security-sensitive when it modifies areas such as:

* authentication;
* authorization;
* sessions;
* roles/permissions;
* staff invitations;
* object-level authorization;
* service-to-service authentication;
* secret handling;
* admin/destructive operations;
* untrusted HTML rendering;
* public exposure of internal services;
* sensitive logging;
* security headers or infrastructure protections.

Such changes require verification appropriate to their risk.

Do not reduce or disable an existing security control merely to make tests or implementation pass.

Testing rules are documented in `../testing/overview.md`.

## Failure behavior

Security controls must not be used as variables in debugging.

When implementation fails because of a security boundary, Codex must not autonomously:

* disable authentication;
* bypass authorization;
* expose an internal service publicly;
* hardcode credentials;
* weaken secret handling;
* remove validation;
* disable infrastructure protections.

Stop and identify the actual problem instead.

Root `AGENTS.md` defines the explicit approval requirements for security-affecting and destructive actions.

## Open Questions

The following security details remain intentionally open until concrete features require them:

* exact sanitization policy/library for rendered untrusted HTML;
* whether additional roles beyond the currently confirmed domain model are required;
* whether additional granular permissions are required beyond the currently confirmed domain model;
* concrete audit-log schema and retention policy;
* concrete session lifetime/rotation policy;
* concrete service-to-service credential rotation mechanism;
* additional production security headers/policies beyond framework/platform defaults.

These questions must be resolved from concrete security and product requirements rather than by introducing speculative security infrastructure.
