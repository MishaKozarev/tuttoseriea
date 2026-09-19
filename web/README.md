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
`AUTH_TRUST_HOST` and provider-specific secrets are not configured in repository
defaults; add them only when the corresponding deployment/proxy/provider contract
is verified.

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
secret through `X-Internal-API-Key`.

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
pnpm ai:client:check
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
