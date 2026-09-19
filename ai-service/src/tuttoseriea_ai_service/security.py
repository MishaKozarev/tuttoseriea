import os
import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader

INTERNAL_API_KEY_ENV = "AI_SERVICE_INTERNAL_API_KEY"
INTERNAL_API_KEY_HEADER = "X-Internal-API-Key"

internal_api_key_header = APIKeyHeader(
    name=INTERNAL_API_KEY_HEADER,
    auto_error=False,
)


def require_internal_api_key(
    api_key: str | None = Depends(internal_api_key_header),
) -> None:
    expected_api_key = os.environ.get(INTERNAL_API_KEY_ENV)

    if not expected_api_key:
        raise RuntimeError(f"{INTERNAL_API_KEY_ENV} is required")

    if api_key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing internal API key",
        )

    if not secrets.compare_digest(api_key, expected_api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid internal API key",
        )
