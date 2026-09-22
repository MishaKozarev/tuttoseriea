import pytest
from fastapi.testclient import TestClient

from tuttoseriea_ai_service.config import ConfigurationError, load_settings
from tuttoseriea_ai_service.main import create_app


def test_settings_accept_valid_key() -> None:
    settings = load_settings({"AI_SERVICE_INTERNAL_API_KEY": "expected-key"})

    assert settings.ai_service_internal_api_key == "expected-key"


def test_startup_fails_when_required_key_is_not_configured(monkeypatch) -> None:
    monkeypatch.delenv("AI_SERVICE_INTERNAL_API_KEY", raising=False)

    with pytest.raises(
        ConfigurationError,
        match="AI_SERVICE_INTERNAL_API_KEY is required",
    ):
        with TestClient(create_app()):
            pass


def test_startup_fails_when_required_key_is_empty(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "")

    with pytest.raises(
        ConfigurationError,
        match="AI_SERVICE_INTERNAL_API_KEY is required",
    ):
        with TestClient(create_app()):
            pass


def test_health_is_public_and_deterministic(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")

    with TestClient(create_app()) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_internal_health_rejects_missing_key(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")

    with TestClient(create_app()) as client:
        response = client.get("/internal/health")

    assert response.status_code == 401


def test_internal_health_rejects_wrong_key(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")

    with TestClient(create_app()) as client:
        response = client.get(
            "/internal/health",
            headers={"X-Internal-API-Key": "wrong-key"},
        )

    assert response.status_code == 403


def test_internal_health_accepts_correct_key(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")

    with TestClient(create_app()) as client:
        response = client.get(
            "/internal/health",
            headers={"X-Internal-API-Key": "expected-key"},
        )

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_openapi_contract_contains_stage_2_6_endpoints(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")

    with TestClient(create_app()) as client:
        response = client.get("/openapi.json")

    assert response.status_code == 200

    contract = response.json()
    assert "/health" in contract["paths"]
    assert "/internal/health" in contract["paths"]
    assert "APIKeyHeader" in contract["components"]["securitySchemes"]
