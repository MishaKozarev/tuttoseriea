# ai-service

Minimal FastAPI foundation for the internal `ai-service/`.

Stage 2.6 does not connect to PostgreSQL, call AI providers, implement vector
storage or integrate with `web/`.

## Requirements

- Python `3.14.x`
- `uv`

## Environment

The application reads configuration from the process environment. `.env.example`
documents the required variable names, but the FastAPI process does not load
`.env.local` by itself.

```bash
cp .env.example .env.local
```

Set `AI_SERVICE_INTERNAL_API_KEY` to a LOCAL-only value before startup. Do not
commit real service-to-service secrets.

## Commands

Install dependencies:

```bash
uv sync --locked --dev
```

Run checks:

```bash
uv run ruff check .
uv run pytest
```

## Testing

AI-service tests use `pytest`.

Reusable deterministic fixtures live in `tests/conftest.py`:

- `configured_internal_api_key` sets the safe test-only
  `AI_SERVICE_INTERNAL_API_KEY`;
- `app` creates a fresh FastAPI application for a test;
- `client` provides a FastAPI `TestClient`;
- `internal_auth_headers` provides the protected endpoint header without using
  real secrets.

Tests should be deterministic, order-independent and isolated from external
services. Do not call real AI providers, Football API providers or other paid,
quota-limited services from automated tests by default.

For unit tests, mocks or fakes are acceptable when persistence semantics are not
the behavior under test. Integration tests that require database behavior must
use real PostgreSQL + pgvector. SQLite is not a substitute for PostgreSQL
behavior in this project.

Export the deterministic OpenAPI JSON from source without starting an HTTP
server:

```bash
uv run --no-sync python -m tuttoseriea_ai_service.openapi
```

The web TypeScript contract is generated from this source export, not from a
staging or production URL.

Run locally on Windows:

```powershell
$env:AI_SERVICE_INTERNAL_API_KEY = "change-me-local-only"
uv run uvicorn tuttoseriea_ai_service.main:app --host 127.0.0.1 --port 8000
```

Or from a POSIX shell:

```bash
AI_SERVICE_INTERNAL_API_KEY=change-me-local-only uv run uvicorn tuttoseriea_ai_service.main:app --host 127.0.0.1 --port 8000
```

Available Stage 2.6 endpoints:

- `GET /health` - unauthenticated liveness check.
- `GET /internal/health` - protected by `X-Internal-API-Key`.
- `GET /openapi.json` - generated FastAPI OpenAPI contract.

## Error Handling

Project-owned FastAPI errors use the canonical external error shape:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Safe user-facing message",
    "requestId": "request-id"
  }
}
```

Expected application failures raise `ApplicationError` with an explicit HTTP
status, stable `code` and safe `message`. Request validation failures return
HTTP `422` with `VALIDATION_ERROR`. Unexpected exceptions return HTTP `500`
with `INTERNAL_SERVER_ERROR` and do not expose stack traces, raw exception text,
secrets or internal implementation details.

`X-Request-ID` is the request correlation header. A valid incoming value is
reused in the response body and response header. If the request does not provide
one, the service generates a single fallback request id for that request.

The protected `/internal/health` endpoint keeps the existing
`X-Internal-API-Key` protocol:

- missing internal API key: HTTP `401`, `INTERNAL_API_KEY_MISSING`;
- invalid internal API key: HTTP `403`, `INTERNAL_API_KEY_INVALID`;
- valid internal API key: HTTP `200`, `{"status": "ok"}`.

New expected application errors should be represented as `ApplicationError` and
serialized only by the centralized exception handlers.

## Logging

Project-owned AI-service logs are structured JSON lines written to Docker
stdout/stderr through Python's standard logging stack. Canonical fields are:

```json
{
  "timestamp": "2026-01-01T00:00:00+00:00",
  "level": "info",
  "message": "Safe event message",
  "service": "ai-service",
  "requestId": "request-id-or-null"
}
```

Request logs reuse the existing `X-Request-ID` value stored on
`request.state.request_id`. Startup and other non-request logs use
`requestId: null`; they do not create a fake correlation id.

Use levels intentionally:

- `debug`: temporary technical diagnostics, never secrets;
- `info`: startup and controlled normal service events;
- `warn`: expected degraded behavior that is operationally useful;
- `error`: unexpected service failures.

Expected application errors and validation/auth failures should not create noisy
error logs or stack traces by default. Unexpected exceptions are logged once by
the centralized exception handler and the HTTP response remains the safe error
contract.

Sensitive context keys such as `secret`, `token`, `password`, `authorization`,
`cookie`, `apiKey`, `api_key`, `connectionString` and `databaseUrl` are
redacted. Do not log service-to-service keys, authorization headers, cookies,
connection strings, raw request bodies or complete provider payloads by default.

New log events should use a stable message plus minimal safe structured context,
including the request id when the event belongs to a request.

## Container

From repository root:

```bash
docker build -f ai-service/Dockerfile -t tuttoseriea-ai-service:local ai-service
docker run --rm -p 127.0.0.1:8000:8000 -e AI_SERVICE_INTERNAL_API_KEY=change-me-local-only tuttoseriea-ai-service:local
```

The container listens on `0.0.0.0:8000` internally. Publishing the port locally is
only for smoke verification; staging and production exposure remain internal.
