# web

Minimal Next.js foundation for the `web/` application.

## Prerequisites

- Node.js `24.x`;
- `pnpm` `11.23.0`;
- Docker Engine for production container build/smoke verification.

## Getting Started

Install dependencies when they are not already installed:

```bash
pnpm install
```

Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Optionally run an already built application locally:

```bash
pnpm build
pnpm start
```

The production container build enables Next.js standalone output inside Docker and
uses the generated standalone server rather than `pnpm start`.

## Database

The `web` application has a Drizzle ORM foundation for PostgreSQL.

Create a local ignored environment file from the safe example when running
database checks:

```bash
cp .env.example .env.local
```

Set:

- `DATABASE_URL` to the restricted LOCAL runtime role connection string;
- `MIGRATION_DATABASE_URL` to the privileged LOCAL migration/admin role
  connection string;
- `SEED_DATABASE_URL` to the restricted LOCAL seed role connection string;
- `DATABASE_APP_ROLE` and `DATABASE_APP_PASSWORD` to provision the restricted
  runtime role;
- `DATABASE_SEED_ROLE` and `DATABASE_SEED_PASSWORD` to provision the restricted
  seed role;
- `DATABASE_AUTH_SCHEMA` to the Auth.js infrastructure schema name (`auth` by
  default);
- `AUTH_SECRET` to a safe LOCAL-only Auth.js secret.
- `AUTH_URL` to the LOCAL web origin (`http://localhost:3000` by default);
- `AUTH_TRUST_HOST` to `true` for proxy/deployment environments that require
  Auth.js to trust forwarded host headers;
- `AI_SERVICE_URL` to the LOCAL FastAPI service URL (`http://127.0.0.1:8000`
  by default);
- `AI_SERVICE_INTERNAL_API_KEY` to the shared LOCAL-only service-to-service key.

`DATABASE_URL` is a server-side value and must not use a `NEXT_PUBLIC_` prefix.
`MIGRATION_DATABASE_URL` is used only by migration/provisioning tooling and must
not be supplied to the long-running web runtime.
`SEED_DATABASE_URL` is used only by the explicit seed runner. The seed runner
does not use the web runtime role or the privileged migration/admin role.
`AI_SERVICE_URL` and `AI_SERVICE_INTERNAL_API_KEY` are server-side values and
must not use a `NEXT_PUBLIC_` prefix.
`AUTH_SECRET`, `AUTH_URL` and `AUTH_TRUST_HOST` are read by Auth.js. The current
application code does not add separate runtime validation for `AUTH_URL` or
`AUTH_TRUST_HOST`.

Drizzle schema definitions start in `src/db/schema.ts`. Stage 2.3 adds migration
tooling and the first technical migration for `CREATE EXTENSION IF NOT EXISTS
vector`. Stage 2.5 adds Auth.js infrastructure tables in PostgreSQL schema
`auth`. These are adapter/session tables, not Stage 3 Identity domain tables.
The foundation does not add product registration, OAuth, Credentials, email
provider, WebAuthn functionality, application roles, PublicProfile, FastAPI
integration or Stage 3 domain schema.

Stage 2.4 adds a seed foundation without business seed data. The current seed
registry is explicit and empty, so the runner connects to PostgreSQL, acquires
the seed advisory lock, verifies that schema state is unchanged and exits
successfully without inserting rows.

Current database commands:

```bash
pnpm db:generate
pnpm db:generate:custom -- --name=<migration_name>
pnpm db:migrate
pnpm db:migrations:check
pnpm db:provision-role
pnpm db:check
pnpm db:auth:check
pnpm db:provision-seed-role
pnpm db:seed:check-ddl-denied
pnpm db:seed:schema-fingerprint
pnpm db:seed
```

Runtime role provisioning must run after migrations because it synchronizes exact
table grants for infrastructure tables created by migrations. It does not use
blanket DML grants or default privileges.

The production image contains the migration runner and Drizzle migration
artifacts, but the normal Next.js container process does not run migrations on
startup.

The seed runner is manual and is not run by application startup or by the
STAGING/PRODUCTION deployment lifecycle.

Auth.js uses database sessions with the Drizzle adapter and `providers: []` in
the current foundation. No real sign-in provider or registration flow exists yet.
Provider-specific Auth.js secrets are not configured in repository defaults; add
them only when the corresponding provider contract is verified.

## AI Service Contract

The FastAPI OpenAPI contract is exported from the `ai-service` source tree and
converted to TypeScript for the server-side web client.

Generate the tracked TypeScript contract after changing FastAPI route schemas:

```bash
pnpm ai:contract:generate
```

Check that the committed generated contract is current:

```bash
pnpm ai:contract:check
```

The generated file is:

```text
src/generated/ai-service-openapi.d.ts
```

The current web client is a small server-only wrapper for
`GET /internal/health`. It uses native `fetch`, reads `AI_SERVICE_URL` and
`AI_SERVICE_INTERNAL_API_KEY` from server environment variables, and sends the
secret through `X-Internal-API-Key` while propagating `X-Request-ID`.

Run the mocked client check:

```bash
pnpm ai:client:check
```

For a live LOCAL check, start `ai-service` on `127.0.0.1:8000` with the same
`AI_SERVICE_INTERNAL_API_KEY`, then run:

```bash
pnpm ai:client:check:live
```

No public Next.js proxy route exists for FastAPI in this foundation.

## API Error Handling

Project-owned Web API boundaries use the canonical external error shape:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Safe user-facing message",
    "requestId": "request-id"
  }
}
```

Expected application errors use `ApplicationError` with an explicit HTTP status,
stable `code` and safe `message`. Unexpected errors serialize as
`INTERNAL_SERVER_ERROR` with HTTP `500` and do not expose stack traces, SQL
errors, secrets or raw exception text.

Route Handlers owned by the application should use the shared error helpers in
`src/api/errors.ts`. Auth.js routes are owned by Auth.js and are not wrapped in
the project API error boundary.

`X-Request-ID` is the request correlation header. A valid incoming value is
reused; otherwise the boundary generates a single fallback request id. The
server-side AI service client forwards that same value to FastAPI as
`X-Request-ID`.

Web maps AI-service failures without passing through raw upstream bodies:

- timeout: HTTP `504`, `AI_SERVICE_TIMEOUT`;
- network/connectivity failure: HTTP `502`, `AI_SERVICE_NETWORK_ERROR`;
- AI-service `5xx`: HTTP `502`, `AI_SERVICE_UNAVAILABLE`;
- malformed or unexpected upstream response: HTTP `502`,
  `AI_SERVICE_BAD_RESPONSE`;
- known expected AI-service `400`, `404`, `409` and `422`: same HTTP status,
  `AI_SERVICE_REQUEST_REJECTED`.

Run the local error contract checks:

```bash
pnpm api:error:check
pnpm ai:client:check
pnpm test
```

## Server Logging

Project-owned server-side Web logs are structured JSON lines written to
stdout/stderr with the canonical fields:

```json
{
  "timestamp": "2026-01-01T00:00:00.000Z",
  "level": "info",
  "message": "Safe event message",
  "service": "web",
  "requestId": "request-id-or-null"
}
```

`X-Request-ID` is the correlation id for request-scoped logs and is propagated
to `ai-service`. Logs outside a request context use `requestId: null`; they do
not create fake request ids.

Use levels intentionally:

- `debug`: temporary technical diagnostics, never secrets;
- `info`: controlled normal events;
- `warn`: expected degraded situations such as AI-service timeout, network,
  `5xx` or malformed responses;
- `error`: unexpected project-owned failures.

The logger redacts sensitive context keys such as `secret`, `token`, `password`,
`authorization`, `cookie`, `apiKey`, `api_key`, `connectionString` and
`databaseUrl`. Do not log request bodies, cookies, authorization headers,
connection strings or raw provider/database exception messages by default.

New log events should use a stable message plus minimal safe structured context,
including `requestId` when the event belongs to a request.

## Container Image

From repository root:

```bash
docker build -f web/Dockerfile -t tuttoseriea-web:local web
docker run --rm -p 3000:3000 tuttoseriea-web:local
```

If host port `3000` is occupied, map another host port to container port `3000`.

CI publishes the `web` image to GHCR on `push` to `main` after the required checks
and container smoke pass:

```text
ghcr.io/mishakozarev/tuttoseriea/web:sha-<commit-sha>
```

## Checks

```bash
pnpm lint
pnpm build
pnpm db:migrate
pnpm db:migrate
pnpm db:migrations:check
pnpm db:provision-role
pnpm db:check
pnpm db:auth:check
pnpm db:provision-seed-role
pnpm db:seed:check-ddl-denied
pnpm db:seed
pnpm db:seed
pnpm db:migrations:check
pnpm ai:contract:check
pnpm api:error:check
pnpm ai:client:check
pnpm test
docker build -f web/Dockerfile -t tuttoseriea-web:local web
```

## Foundation

This app was bootstrapped with:

- Next.js App Router;
- TypeScript;
- Tailwind CSS;
- ESLint;
- pnpm;
- Drizzle ORM foundation;
- Auth.js database-session foundation;
- server-only FastAPI communication foundation.

No product features, business seed data, real auth provider, registration flow,
AI business workflows or service-specific domain logic are part of this
foundation yet.

## Next.js Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [create-next-app CLI](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
