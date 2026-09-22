import secrets

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader

from tuttoseriea_ai_service.config import Settings

INTERNAL_API_KEY_HEADER = "X-Internal-API-Key"

internal_api_key_header = APIKeyHeader(
    name=INTERNAL_API_KEY_HEADER,
    auto_error=False,
)


def get_settings(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)

    if not isinstance(settings, Settings):
        raise RuntimeError("AI service settings are not initialized")

    return settings


def require_internal_api_key(
    api_key: str | None = Depends(internal_api_key_header),
    settings: Settings = Depends(get_settings),
) -> None:
    if api_key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing internal API key",
        )

    if not secrets.compare_digest(api_key, settings.ai_service_internal_api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid internal API key",
        )
