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

The application also exposes a minimal project-owned liveness endpoint:

```text
GET /api/health
```

It returns `{"status":"ok"}` without reading the database, external services or
secrets. It is used by the Web smoke foundation and is also suitable for basic
local runtime checks.

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
- `DATABASE_IDENTITY_SCHEMA` to the Identity domain schema name (`identity` by
  default);
- `DATABASE_JOBS_SCHEMA` to the shared job coordination schema name (`jobs` by
  default);
- `JOB_RUNNER_LEASE_SECONDS`, `JOB_RUNNER_MAX_ATTEMPTS`,
  `JOB_RUNNER_RETRY_DELAY_SECONDS` and `JOB_RUNNER_RETRY_DELAY_CAP_SECONDS` for
  the shared job runner defaults;
- `AUTH_SECRET` to a safe LOCAL-only Auth.js secret.
- `AUTH_URL` to the LOCAL web origin (`http://localhost:3000` by default);
- `AUTH_TRUST_HOST` to `true` for proxy/deployment environments that require
  Auth.js to trust forwarded host headers;
- `AUTH_STAFF_EMAIL_DELIVERY=disabled` by default to prevent accidental external
  SMTP email sends;
- `AUTH_EMAIL_SERVER` and `AUTH_EMAIL_FROM` for the staff magic-link provider
  when email delivery is explicitly enabled;
- `AI_SERVICE_URL` to the LOCAL FastAPI service URL (`http://127.0.0.1:8000`
  by default);
- `AI_SERVICE_INTERNAL_API_KEY` to the shared LOCAL-only service-to-service key.
- `API_FOOTBALL_ENABLE_REAL=false` by default so real API-Football calls require
  explicit opt-in;
- `API_FOOTBALL_BASE_URL` to the API-Football v3 base URL
  (`https://v3.football.api-sports.io/` by default);
- `API_FOOTBALL_TIMEOUT_MS` to the API-Football request timeout in
  milliseconds (`10000` by default);
- `API_FOOTBALL_KEY` only for explicitly approved real-provider verification or
  operations.

`DATABASE_URL` is a server-side value and must not use a `NEXT_PUBLIC_` prefix.
`MIGRATION_DATABASE_URL` is used only by migration/provisioning tooling and must
not be supplied to the long-running web runtime.
`SEED_DATABASE_URL` is used only by the explicit seed runner. The seed runner
does not use the web runtime role or the privileged migration/admin role.
`AI_SERVICE_URL` and `AI_SERVICE_INTERNAL_API_KEY` are server-side values and
must not use a `NEXT_PUBLIC_` prefix.
`API_FOOTBALL_KEY` is a server-side secret and must not use a `NEXT_PUBLIC_`
prefix. Its presence alone does not enable real provider calls.
`AUTH_SECRET`, `AUTH_URL` and `AUTH_TRUST_HOST` are read by Auth.js. `AUTH_URL`
is also the Web public-origin convention for site-level SEO metadata, canonical
URLs, robots and sitemap output. LOCAL and CI may fall back to
`http://localhost:3000`; STAGING and PRODUCTION must provide a valid public
HTTP/HTTPS origin and must not silently fall back to localhost. The current
application code does not add separate runtime validation for `AUTH_TRUST_HOST`.

Drizzle schema definitions start in `src/db/schema.ts`. Stage 2.3 adds migration
tooling and the first technical migration for `CREATE EXTENSION IF NOT EXISTS
vector`. Stage 2.5 adds Auth.js infrastructure tables in PostgreSQL schema
`auth`. These are adapter/session tables, not Stage 3 Identity domain tables.
Stage 3.4 adds the initial Identity domain schema in `identity`: `accounts`,
`roles` and `account_roles`. `identity.accounts` is the domain Account model and
links one-to-one to `auth.users`; future domain references use
`identity.accounts.id`.

Stage 4.1A adds the shared PostgreSQL job coordination schema in `jobs`:
`executions`. It stores canonical job type/idempotency scope, lifecycle state,
claim ownership, fencing version, retry availability and safe diagnostic error
fields. It is infrastructure foundation only; no Football provider job is
registered yet.

Stage 4.1B adds the API-Football provider integration foundation. It provides
server-side provider configuration, explicit real-provider opt-in, bounded
HTTP retry/timeout behavior, provider envelope/error normalization and fixture
status normalization. It does not add Football persistence, sync jobs,
scheduler behavior, admin UI or bulk import.

The foundation does not add product registration, OAuth, Credentials, WebAuthn
functionality, PublicProfile, FastAPI integration or public Identity onboarding.

Stage 2.4 adds a seed foundation without business seed data. The current seed
registry is explicit and empty, so the runner connects to PostgreSQL, acquires
the seed advisory lock, verifies that schema state is unchanged and exits
successfully without inserting rows.

Current database commands:

```bash
pnpm db:generate
pnpm db:generate:custom --name=<migration_name>
pnpm db:migrate
pnpm db:migrations:check
pnpm db:provision-role
pnpm db:check
pnpm db:jobs:check
pnpm db:auth:check
pnpm db:identity:check
pnpm db:provision-seed-role
pnpm db:seed:check-ddl-denied
pnpm db:seed:schema-fingerprint
pnpm db:seed
```

Runtime role provisioning must run after migrations because it synchronizes exact
table grants for infrastructure tables created by migrations. It does not use
blanket DML grants or default privileges.

For `jobs.executions`, the runtime role receives only `SELECT`, `INSERT` and
`UPDATE`. It does not receive `DELETE`, schema `CREATE`, sequence privileges or
default privileges.

The production image contains the migration runner and Drizzle migration
artifacts, but the normal Next.js container process does not run migrations on
startup.

The seed runner is manual and is not run by application startup or by the
STAGING/PRODUCTION deployment lifecycle.

Auth.js uses database sessions with the Drizzle adapter. Stage 3.4 configures a
staff-only Email/Nodemailer magic-link provider. It is restricted to
pre-provisioned staff identities and separately checks `admin.access`;
authentication alone does not grant `/admin` access. External SMTP delivery is
disabled by default and must not be enabled or used without explicit approval.

Staff identities can be provisioned with:

```bash
pnpm identity:provision-staff -- --email=<staff-email> --roles=writer
```

This is an operational command. Do not run it for real staff identities without
separate explicit approval. Use `--dry-run` for a rollback-only verification.

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

## Testing

`pnpm run test` is the stable CI-facing Web test command. It runs the existing
Stage 2.8-2.10 contract checks and the Vitest unit/component suite.

Available Web test commands:

```bash
pnpm run test
pnpm run test:contracts
pnpm run test:unit
pnpm run test:smoke
pnpm run jobs:build
pnpm run jobs:run -- --check-runtime
pnpm run db:jobs:check
```

`test:contracts` preserves the existing server-side configuration, API error,
structured logging and AI client checks. The individual commands
`config:check`, `api:error:check`, `logging:check`, `ai:client:check`,
`ai:contract:check` and `ai:client:check:live` remain supported.

Vitest uses the Node environment by default. Component tests opt into `jsdom`
only where DOM rendering is needed. React component tests use React Testing
Library and should assert observable behavior, not implementation details.

The current Playwright smoke command starts the local Web app, verifies `/`,
checks that the public shell renders, verifies `GET /api/health`, and verifies
the site-level SEO foundation at `/robots.txt` and `/sitemap.xml`.
Before running it locally for the first time, install the Chromium browser used
by the smoke test:

```bash
pnpm exec playwright install chromium
pnpm run test:smoke
```

Automated tests must not require production secrets or real paid/limited
providers. Use deterministic fixtures, mocks or fakes for unit tests when
persistence semantics are not under test.
API-Football tests use injected fake provider responses and must not consume
real provider quota.

Database integration tests must use real PostgreSQL + pgvector. SQLite is not a
substitute for PostgreSQL or Drizzle behavior. The existing CI database checks
reuse the PostgreSQL service in the Web job and must not be replaced by a second
parallel DB-test mechanism.

`db:jobs:check` uses an injectable test registry against real PostgreSQL to
verify shared job create/claim/finalize, retry scheduling, duplicate active
no-op behavior, stale recovery and heartbeat/fencing loss.

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
docker run --rm --entrypoint node tuttoseriea-web:local /app/job-runner/cli.js --check-runtime
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
pnpm run test
pnpm run test:contracts
pnpm run test:unit
pnpm run test:smoke
pnpm run jobs:build
pnpm run jobs:run -- --check-runtime
pnpm lint
pnpm build
pnpm db:migrate
pnpm db:migrate
pnpm db:migrations:check
pnpm db:provision-role
pnpm db:check
pnpm db:jobs:check
pnpm db:auth:check
pnpm db:identity:check
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
- server-only FastAPI communication foundation;
- shared PostgreSQL job runner foundation.

The public UI foundation uses root-level App Router files, shared layout
components under `components/layout`, and the shadcn/ui baseline under
`components/ui`.

The public container convention is layered:

- `wide`: max width `80rem`, for the shell, header/footer alignment and future
  data-heavy views;
- `normal`: max width `70rem`, for default public content;
- `narrow`: max width `45rem`, for editorial or article-like content.

Horizontal shell padding is `1rem` on mobile, `1.5rem` on tablet-sized screens
and `2rem` on desktop-sized screens. Future product stages can choose the
appropriate layer per view without changing the baseline shell.

The Stage 3 site-level SEO foundation uses Next.js Metadata API, `robots.ts` and
`sitemap.ts`. Root layout metadata defines only site-wide defaults such as
`metadataBase`, title template and Russian description. The current public home
route owns canonical `/`. Admin/private surfaces under `/admin` are explicitly
`noindex`/`nofollow`, and the sitemap currently contains only the existing
preferred public URL `/`.

No product features, business seed data, real auth provider, registration flow,
AI business workflows or service-specific domain logic are part of this
foundation yet.

## Next.js Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [create-next-app CLI](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
