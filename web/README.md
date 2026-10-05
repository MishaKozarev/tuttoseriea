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
- `DATABASE_FOOTBALL_SCHEMA` to the Football domain schema name (`football` by
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

Stage 4.2 adds the initial Football domain persistence in schema `football`:
`competitions`, `seasons`, `clubs` and `season_clubs`. The first registered
production job type is `football.sync-serie-a-foundation`, scoped only to
API-Football Serie A league `135` and season `2026`. The job accepts no runtime
arguments and uses the canonical idempotency key
`api-football:league:135:season:2026:foundation`.

The Stage 4.2 sync preserves application-owned values such as the Serie A slug
and Russian display name, club `slug` and club `name_ru`. Provider-owned fields
are updated on repeated sync. Missing provider rows are not deleted in this
stage.

Stage 4.3 adds `football.matches` and the controlled
`football.sync-serie-a-matches` job for the complete Serie A 2026/27 season.
The job accepts no runtime arguments, requests only
`/fixtures?league=135&season=2026`, validates the complete season response and
season-club references before writing, and persists all 380 fixtures in one
transaction. Existing fixtures are updated by provider identity; a fixture
missing from a later provider response is not deleted. Every match retains the
complete provider fixture object in `provider_raw` alongside first-class date,
venue, referee, status, winner and score fields.

The public `/calendar` route reads the current season only from PostgreSQL. No
public request calls API-Football. The later Match lifecycle dispatcher reuses
this full-season job as its sole authoritative lifecycle refresh; it does not
introduce a second fixture sync implementation.

Stage 4.4 adds the current-season `football.standings` snapshot and the
fixed-argument `football.sync-serie-a-standings` production job. The job calls
only `/standings?league=135&season=2026`, requires one complete 20-club table,
validates every club against the persisted season membership and replaces no
rows outside its provider-identity upserts. A malformed or partial response is
rejected before writes; persistence is all-or-nothing in one transaction.

The public `/table` route reads standings only from PostgreSQL. Provider
descriptions are retained as provider facts and are not converted into
application-owned qualification zones at this stage. Every Football job logs
one safe `api_football_requests=<N>` total for its client instance, counting
actual outbound attempts including bounded HTTP retries. Automatic scheduling
and root-owned operational allowlisting for the standings job are not part of
Stage 4.4 LOCAL implementation. The accepted starting refresh policy is
approximately hourly through future controlled scheduling; Stage 4.4 stores
only current state and adds no standings history or snapshot timeline.

Stage 4.5 adds stable provider player entities in `football.players` and the
latest known current-club membership state in `football.squad_memberships`.
The fixed-argument `football.sync-serie-a-squads` job resolves the exact 20
clubs from the persisted Serie A 2026 season scope, then calls only
`/players/squads?team=<provider_team_id>` once per club on a clean run. The
provider endpoint is not season-aware: season `2026` scopes the clubs to sync
but does not make a membership historical season evidence.

All 20 provider responses are fetched and validated before mutation. Players
are upserted by provider identity and current memberships are reconciled in one
transaction; stale memberships are deleted while stable player rows remain.
Membership `position` is retained as the provider-owned string after runtime
type/structure validation, without a closed application enum or normalization.
Each membership retains a non-null `provider_raw` array containing every
complete provider player record for that club/player group. A single record or
fully identical duplicates preserve their common shirt number; duplicates that
differ only by `number` produce one membership with a null shirt number. Any
other difference is a terminal provider data-contract failure.
No historical squad snapshots, player statistics or public player/club squad
pages are introduced in Stage 4.5.

Stage 4.6 enriches stable `football.players` profiles and adds the current
season snapshot in `football.player_statistics`, uniquely identified by
`(season_id, club_id, player_id)`. The fixed-argument
`football.sync-serie-a-player-statistics` job calls only
`/players?league=135&season=2026&page=<N>`. Page 1 establishes a positive total
page count; every page must report the requested current page and the same
total. All pages are fetched and validated before database mutation. The
provider does not guarantee a point-in-time snapshot across those sequential
requests, which is an accepted integration limitation; this job must not be
split into independently polled pages.

Complete player and individual statistics provider objects are retained in
non-null `player_raw` and `statistics_raw` JSONB. Provider nullable values stay
null and are not coerced. One player may have separate rows for different clubs
in the same season. Fully identical duplicate player/team/league/season entries
are collapsed globally across pages; conflicting statistics or conflicting
stable player profiles fail terminally before mutation. A successful run
upserts player profiles and statistics and removes stale statistics only for
the current season in one transaction. Stable players, current squad
memberships and other Football tables are not deleted or reconciled by this
job. Stage 4.6 adds no public player/statistics UI, scheduler or operational
STAGING/PRODUCTION allowlist entry.

Stage 4.8.2 adds `football.match_events` and the application job type
`football.sync-serie-a-match-events`. The job requires exactly
`--match-id <lowercase-uuid>`, verifies that the Match belongs to the persisted
Serie A `135` / season `2026` scope, and calls only
`/fixtures/events?fixture=<provider_fixture_id>`. Provider event order is stored
as structural order for the current snapshot; neither that order nor the
internal row UUID is a durable logical provider-event identity.

Each complete valid response replaces one Match's prior events atomically.
Validation and Team/Player resolution happen before the existing execution
heartbeat and transaction; the transaction contains only `DELETE`, complete
snapshot `INSERT`s and `COMMIT`, with no heartbeat inside it. Team resolution is
strict to the Match participants. Player links are best-effort and nullable:
the sync never creates Players, and every later snapshot resolves them again.
Expected empty snapshots succeed silently for scheduled, postponed, cancelled
and walkover Matches. Empty live, paused, suspended, interrupted, abandoned,
finished or awarded snapshots still succeed but emit one structured anomaly
warning. The job is registered in the application image only; restricted
STAGING/PRODUCTION operational allowlists are unchanged.

Stage 4.8.3 adds current team snapshots in `football.match_lineups` with
ordered starter/substitute rows in `football.match_lineup_entries`, plus the
application job type `football.sync-serie-a-match-lineups`. The job requires
exactly `--match-id <lowercase-uuid>`, resolves the persisted current Serie A
Match before any provider request, and calls only
`/fixtures/lineups?fixture=<provider_fixture_id>`. Returned Teams must be the
exact Match participants. Existing Players are linked only by positive
provider identity; unresolved Players remain nullable, are not created, and
are resolved again on every run.

A valid returned Team is treated operationally as its complete current
snapshot. Received Teams are replaced together in one Match-scoped
transaction after validation, resolution and the existing heartbeat. A
one-Team response replaces only that Team and emits a structured partial
snapshot anomaly; the absent Team is retained. An empty response is a success
and never deletes persisted lineups. It is silent only for a scheduled Match
without persisted lineups, and otherwise emits a structured anomaly when the
normalized Match state indicates lineups should be available or a prior
lineup exists. Internal UUIDs and role-scoped provider order are structural
current-snapshot details, not durable provider identities. The application job
registry changes, but restricted STAGING/PRODUCTION operational allowlists do
not.

Stage 4.8.4 adds current full-match Team snapshots in
`football.match_statistics`, ordered provider items in
`football.match_statistic_items`, and application job type
`football.sync-serie-a-match-statistics`. The job requires exactly
`--match-id <lowercase-uuid>`, resolves a persisted current Serie A Match before
provider access and calls only `/fixtures/statistics?fixture=<provider_fixture_id>`
without `half`. Statistic types remain open provider strings; number, string and
provider null values are stored losslessly as constrained JSONB scalars. Duplicate
types remain separate structural-order items and produce a structured anomaly.

All validation and Team resolution precede the existing heartbeat. Received Teams
with non-empty statistics are replaced together in one short Match transaction with
no heartbeat inside it. Missing Teams are retained. Empty responses are successful
no-ops, and received Teams with empty `statistics` arrays are retained without
refreshing `observed_at` and produce a structured anomaly. The application registry
changes from seven to eight types; restricted STAGING/PRODUCTION allowlists remain
unchanged.

Stage 4.8.5 composes the persisted base Match, Events, Lineups and full-match
Statistics into the public `/matches/[slug]` page without request-time provider
access. The read model uses a fixed four-query shape: one base Match read and
three bounded section reads, with no per-row queries. Events preserve provider
order; Lineups preserve role-scoped provider order; Statistics preserve every
independent Team item in provider order, including duplicate provider types and
number, string or null scalar values. The page does not synthesize cross-Team
statistic pairs or imply common freshness across independently synchronized
sections.

Each persisted Team side renders independently, and a complete section is
omitted only when it has no persisted data. Event and Lineup Player identities
link to `/players/[slug]` only when the resolved Player satisfies the existing
current Serie A public eligibility rule; unresolved and ineligible identities
remain plain text. Calendar and Club fixture summaries now link to their
canonical Match pages while their Club identities remain separate Club links.
No pitch/grid interpretation, provider-colour styling, schema migration,
provider synchronization, job, scheduler or operational allowlist change is
part of this integration.

The Stage 4 Match operational lifecycle adds nullable
`football.matches.status_changed_at` and an app-owned dispatcher packaged in
the immutable Web image. Existing rows are deliberately not backfilled. New
Matches receive DB `now()` on insert; updates move the marker only when the
normalized status changes, so raw provider transitions within one normalized
state do not move it. Historical finished or abandoned rows with a null marker
remain outside automatic recovery.

The dispatcher keeps the production registry at eight job types. It refreshes
lifecycle through `football.sync-serie-a-matches`, then invokes the existing
Events, Lineups and Statistics definitions with their canonical Match scope,
job retries, leases and fencing. A fresh lifecycle success is required before
dataset fan-out. A rollout-time active Match with a null marker is admitted
only after that gate; terminal recovery requires a non-null transition at or
after the explicit stable `managed_from` boundary and inside the configured
recovery horizon. Dataset concurrency is capped at two, and a PostgreSQL
session advisory lock makes overlapping dispatcher ticks no-ops without
holding a transaction across provider work.

STAGING recurrence is represented only by reviewed root-owned systemd and
wrapper templates under `scripts/vds/`. The wrapper accepts no arguments and
uses the approved restricted release reader to run the exact deployed Web
digest with a fixed network, env files and dispatcher entrypoint. Application
deployment does not install or activate these files. There is no Production
timer, historical backfill, ninth job type or execution cleanup subsystem.

Historical finished Match data is handled by a separate bounded one-off CLI,
`node /app/job-runner/match-data-backfill.js --dry-run|--run`. It is not part
of the lifecycle dispatcher and does not add a production job type. Its fixed
scope is API-Football league `135`, season `2026`, normalized status
`finished`; callers cannot supply an alternate competition, season, status or
Match list. Dry-run performs PostgreSQL reads only and creates no job
executions or provider clients. Run mode, which requires separate bulk
authorization, invokes only missing datasets through the existing canonical
Match jobs with concurrency capped at two.

Events are complete when persisted events exist or a canonical successful
Events execution proves a legitimate zero-event response. Lineups and full
Match Statistics are complete only when snapshots exist for both participating
clubs. Run mode repeats this same read after all operations; a successful
partial or empty Lineups/Statistics job remains visibly incomplete and makes
the one-off command fail overall.

The Football localization foundation stores application-owned Russian proper
names and review state directly on `football.competitions`, `football.clubs`
and `football.players`. A Russian name is either absent together with its
status, or present with status `unreviewed` or `reviewed`; database constraints
enforce that pair. Existing Competition and Club Russian names migrate as
`unreviewed`, never as reviewed canonical data. Provider syncs continue to
update provider-owned fields but do not write either localization field, and a
new provider Competition starts without an automatic Russian name.

Public Football name resolution uses a non-empty Russian value only when its
status is `reviewed`; all other states fall back to the persisted provider
name. Geography first resolves an exact provider alias or football-specific
override to a normalized identity, then uses Russian `Intl.DisplayNames` for
known regions, with the original provider value as the fallback. Fixture
statuses, common player positions and player-statistics labels use deterministic
Russian dictionaries. Match rounds, standings descriptions and standings form
use bounded formatters while preserving unknown provider values. No generic
translation table, AI localization, admin/editorial localization workflow,
city/venue localization or Stage 4.7/4.8 UI is introduced here.

Stage 4.7.1 adds the indexable DB-only Club Page at `/clubs/[slug]`. It uses the
stable application-owned club slug and is explicitly scoped to the persisted
Serie A league `135` / season `2026` participation. The page combines the club
profile, optional current standing, five recent and five upcoming fixtures, and
the current `squad_memberships` roster with a small matching current-season
statistics set. Every dataset degrades independently, and public requests never
call API-Football. Current squad membership remains current-state data rather
than historical season evidence. Player and Match detail links are not added. A
route-specific Next.js Proxy existence check runs only for one-segment Club
detail paths so an unknown slug receives a real HTTP `404` before the root
loading boundary starts streaming; the page still owns the authoritative read
and `notFound()` behavior.

Stage 4.7.3 adds the indexable DB-only General Statistics page at
`/statistics`, explicitly scoped to API-Football league `135` and season
`2026`. Player leaderboards aggregate typed `football.player_statistics`
values across every contributing club row so a transferred player appears
once while retaining canonical links to every contributing club. Additive
metrics use conservative null semantics: all contributing values must be known
before they are summed, and null is never coerced to zero. Goals, assists,
appearances and minutes use stable competition ranking with equal displayed
ranks and deterministic provider-identity ordering inside ties. The page also
reads all current team overall/home/away values from `football.standings`.
Each section has an independent empty state. The route adds no provider call,
sync, schema, migration, scheduler or freshness timestamp.

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
pnpm db:football:check
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

For the managed Football tables, the runtime role receives only the exact DML
needed by each table. `football.squad_memberships` additionally receives
`DELETE` for current-state reconciliation; unrelated Football tables, including
`football.players`, do not. The role does not receive schema `CREATE`, sequence
privileges or default privileges.

`football.player_statistics` receives `SELECT`, `INSERT`, `UPDATE` and `DELETE`;
`DELETE` is limited to current-season snapshot reconciliation. The related
stable `football.players` table remains without `DELETE`.

`football.match_events` receives only `SELECT`, `INSERT` and `DELETE` for full
per-Match snapshot replacement. It receives neither `UPDATE` nor blanket table
privileges.

`football.match_lineups` receives only `SELECT`, `INSERT` and `DELETE` for
team-snapshot replacement. `football.match_lineup_entries` receives only
`SELECT` and `INSERT`; entry deletion occurs only through the parent
`ON DELETE CASCADE`. Neither table receives `UPDATE` or blanket privileges.

`football.match_statistics` receives only `SELECT`, `INSERT` and `DELETE` for
received-Team snapshot replacement. `football.match_statistic_items` receives only
`SELECT` and `INSERT`; child deletion occurs through parent `ON DELETE CASCADE`.
Neither table receives `UPDATE` or blanket privileges.

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
pnpm run db:football:check
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

`db:football:check` uses fake API-Football responses against real PostgreSQL to
verify the competition/season/club foundation, matches, Match Events, Match Lineups,
Match Statistics, standings, current squads and paginated player statistics. It covers
repeated-sync idempotency,
provider identity uniqueness,
ownership rules, provider-field and complete snapshot updates, current
membership/statistics reconciliation, real LOCAL PostgreSQL `Pool` rollback
paths, exact runtime grants, public listing queries and the shared job runner
path. It cleans or rolls back its controlled domain fixtures and does not call
the real provider.

## Operational Jobs

Repository-side restricted job workflows are available for manually approved
STAGING and PRODUCTION operations:

```text
.github/workflows/run-job-staging.yml
.github/workflows/run-job-production.yml
scripts/run-job-staging.sh
scripts/run-job-production.sh
scripts/vds/tuttoseriea-run-job-staging
scripts/vds/tuttoseriea-run-job-production
```

The environment-specific job allowlists are:

```text
STAGING: football.sync-serie-a-foundation
STAGING: football.sync-serie-a-matches
STAGING: football.sync-serie-a-standings
STAGING: football.sync-serie-a-squads
STAGING: football.sync-serie-a-player-statistics
STAGING: football.sync-serie-a-match-events --match-id <lowercase-uuid>
STAGING: football.sync-serie-a-match-lineups --match-id <lowercase-uuid>
STAGING: football.sync-serie-a-match-statistics --match-id <lowercase-uuid>
PRODUCTION: football.sync-serie-a-foundation
```

The three Match-scoped types are STAGING-only and accept exactly one structured
`match_id` workflow input, which is transported as
`--match-id <lowercase-uuid>`. Missing, uppercase, malformed or additional
arguments fail closed before the application runner starts. Production remains
foundation-only.

The repository-side scripts call the VDS contract with one exact whitelisted
identifier, for example:

```text
run-job football.sync-serie-a-standings
```

They do not accept arbitrary payloads, argument strings, images, entrypoints,
environment variables, shell commands, Docker commands or sudo. The server-side
VDS forced-command/root-owned implementation is responsible for selecting the
current deployed immutable Web image and controlled runner environment for the
target environment. Real API-Football sync still requires separate explicit
approval before invoking the job.

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
pnpm db:football:check
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
route owns canonical `/`; the Clubs, Calendar and Table listings own their page
canonicals. Club entity pages own canonical `/clubs/[slug]`. Admin/private
surfaces under `/admin` are explicitly `noindex`/`nofollow`. The dynamic sitemap
contains the static public routes `/`, `/clubs`, `/calendar` and `/table`, plus
current Serie A club URLs read from PostgreSQL rather than a hardcoded list.

No product features, business seed data, real auth provider, registration flow,
AI business workflows or service-specific domain logic are part of this
foundation yet.

## Next.js Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [create-next-app CLI](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
