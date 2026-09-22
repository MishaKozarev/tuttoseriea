from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from tuttoseriea_ai_service.config import load_settings
from tuttoseriea_ai_service.security import require_internal_api_key


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.settings = load_settings()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="TuttoSerieA AI Service",
        version="0.1.0",
        summary="Internal FastAPI service foundation for AI workflows.",
        lifespan=lifespan,
    )

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get(
        "/internal/health",
        tags=["internal"],
        dependencies=[Depends(require_internal_api_key)],
    )
    def internal_health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
