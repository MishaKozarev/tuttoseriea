# ai-service

Minimal FastAPI foundation for the internal `ai-service/`.

Stage 2.6 does not connect to PostgreSQL, call AI providers, implement vector
storage or integrate with `web/`.

## Requirements

- Python `3.14.x`
- `uv`

## Environment

Create a local ignored environment file when running the protected internal
endpoint manually:

```bash
cp .env.example .env.local
```

Set `AI_SERVICE_INTERNAL_API_KEY` to a LOCAL-only value. Do not commit real
service-to-service secrets.

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

Run locally on Windows:

```bash
AI_SERVICE_INTERNAL_API_KEY=change-me-local-only uv run uvicorn tuttoseriea_ai_service.main:app --host 127.0.0.1 --port 8000
```

Available Stage 2.6 endpoints:

- `GET /health` - unauthenticated liveness check.
- `GET /internal/health` - protected by `X-Internal-API-Key`.
- `GET /openapi.json` - generated FastAPI OpenAPI contract.

## Container

From repository root:

```bash
docker build -f ai-service/Dockerfile -t tuttoseriea-ai-service:local ai-service
docker run --rm -p 8000:8000 -e AI_SERVICE_INTERNAL_API_KEY=change-me-local-only tuttoseriea-ai-service:local
```

The container listens on `0.0.0.0:8000` internally. Publishing the port locally is
only for smoke verification; staging and production exposure remain internal.
