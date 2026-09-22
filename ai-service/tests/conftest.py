from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tuttoseriea_ai_service.main import create_app
from tuttoseriea_ai_service.security import INTERNAL_API_KEY_HEADER


@pytest.fixture
def internal_api_key() -> str:
    return "expected-key"


@pytest.fixture
def configured_internal_api_key(
    monkeypatch: pytest.MonkeyPatch,
    internal_api_key: str,
) -> str:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", internal_api_key)
    return internal_api_key


@pytest.fixture
def app(configured_internal_api_key: str) -> FastAPI:
    return create_app()


@pytest.fixture
def client(app: FastAPI) -> Generator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def internal_auth_headers(internal_api_key: str) -> dict[str, str]:
    return {INTERNAL_API_KEY_HEADER: internal_api_key}
