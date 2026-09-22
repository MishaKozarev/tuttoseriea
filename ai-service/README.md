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

## Container

From repository root:

```bash
docker build -f ai-service/Dockerfile -t tuttoseriea-ai-service:local ai-service
docker run --rm -p 127.0.0.1:8000:8000 -e AI_SERVICE_INTERNAL_API_KEY=change-me-local-only tuttoseriea-ai-service:local
```

The container listens on `0.0.0.0:8000` internally. Publishing the port locally is
only for smoke verification; staging and production exposure remain internal.
