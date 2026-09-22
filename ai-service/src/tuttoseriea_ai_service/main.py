import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from tuttoseriea_ai_service.config import load_settings
from tuttoseriea_ai_service.errors import register_error_handling
from tuttoseriea_ai_service.security import require_internal_api_key
from tuttoseriea_ai_service.structured_logging import (
    configure_logging,
    exception_context,
)

configure_logging()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    try:
        app.state.settings = load_settings()
    except Exception as exception:
        logger.error(
            "AI service startup failed",
            extra={
                "context": {
                    "event": "service.startup_failed",
                    **exception_context(exception),
                },
                "request_id": None,
            },
        )
        raise

    logger.info(
        "AI service startup complete",
        extra={
            "context": {"event": "service.startup_complete"},
            "request_id": None,
        },
    )
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="TuttoSerieA AI Service",
        version="0.1.0",
        summary="Internal FastAPI service foundation for AI workflows.",
        lifespan=lifespan,
    )
    register_error_handling(app)

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
