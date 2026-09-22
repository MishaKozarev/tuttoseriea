import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tuttoseriea_ai_service.config import ConfigurationError, load_settings
from tuttoseriea_ai_service.errors import (
    ERROR_CODE_INTERNAL_API_KEY_INVALID,
    ERROR_CODE_INTERNAL_API_KEY_MISSING,
    ERROR_CODE_INTERNAL_SERVER_ERROR,
    ERROR_CODE_VALIDATION_ERROR,
    REQUEST_ID_HEADER,
    ApplicationError,
    normalize_request_id,
)
from tuttoseriea_ai_service.main import create_app
from tuttoseriea_ai_service.structured_logging import SERVICE, StructuredJsonFormatter


def assert_error_contract(
    response,
    *,
    code: str,
    message: str,
    request_id: str | None = None,
    status_code: int,
) -> None:
    assert response.status_code == status_code

    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert body["error"]["message"] == message

    response_request_id = body["error"]["requestId"]
    assert response.headers[REQUEST_ID_HEADER] == response_request_id

    if request_id is None:
        assert normalize_request_id(response_request_id) == response_request_id
    else:
        assert response_request_id == request_id


def add_error_test_routes(app: FastAPI) -> None:
    @app.get("/test/application-error")
    def application_error() -> None:
        raise ApplicationError(
            code="CONFLICT",
            message="Safe conflict message",
            status_code=409,
        )

    @app.get("/test/validation")
    def validation_error(limit: int) -> dict[str, int]:
        return {"limit": limit}

    @app.get("/test/unexpected")
    def unexpected_error() -> None:
        raise RuntimeError("secret internal detail")


def format_test_log_record(
    *,
    context: dict[str, object] | None = None,
    level: int = logging.INFO,
    message: str = "AI service logging smoke",
    request_id: str | None = None,
) -> dict[str, object]:
    record = logging.LogRecord(
        name="tuttoseriea_ai_service.tests",
        level=level,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=(),
        exc_info=None,
    )
    record.request_id = request_id

    if context is not None:
        record.context = context

    return json.loads(StructuredJsonFormatter().format(record))


def test_structured_log_shape_and_redaction() -> None:
    entry = format_test_log_record(
        context={
            "apiKey": "secret-api-key",
            "authorization": "Bearer secret-token",
            "cookie": "session=secret-cookie",
            "databaseUrl": "postgresql://user:password@127.0.0.1:5432/app",
            "nested": {"password": "secret-password"},
            "safe": "visible",
        },
        level=logging.WARNING,
        request_id="logging-request",
    )
    serialized = json.dumps(entry)

    assert entry["timestamp"]
    assert entry["level"] == "warn"
    assert entry["message"] == "AI service logging smoke"
    assert entry["service"] == SERVICE
    assert entry["requestId"] == "logging-request"
    assert "visible" in serialized
    assert "secret-api-key" not in serialized
    assert "secret-token" not in serialized
    assert "secret-cookie" not in serialized
    assert "secret-password" not in serialized
    assert "postgresql://" not in serialized


def test_non_request_log_uses_null_request_id() -> None:
    entry = format_test_log_record(context={"event": "service.startup_complete"})

    assert entry["service"] == SERVICE
    assert entry["requestId"] is None


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
        response = client.get("/health", headers={REQUEST_ID_HEADER: "health-request"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers[REQUEST_ID_HEADER] == "health-request"


def test_application_error_uses_project_contract(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")
    app = create_app()
    add_error_test_routes(app)

    with TestClient(app) as client:
        response = client.get(
            "/test/application-error",
            headers={REQUEST_ID_HEADER: "application-error-request"},
        )

    assert_error_contract(
        response,
        code="CONFLICT",
        message="Safe conflict message",
        request_id="application-error-request",
        status_code=409,
    )


def test_application_error_does_not_log_noisy_error(monkeypatch, caplog) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")
    app = create_app()
    add_error_test_routes(app)

    with caplog.at_level(logging.ERROR):
        with TestClient(app) as client:
            caplog.clear()
            response = client.get(
                "/test/application-error",
                headers={REQUEST_ID_HEADER: "expected-error-request"},
            )

    assert response.status_code == 409
    assert not [record for record in caplog.records if record.levelno >= logging.ERROR]


def test_validation_error_uses_project_contract(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")
    app = create_app()
    add_error_test_routes(app)

    with TestClient(app) as client:
        response = client.get(
            "/test/validation",
            headers={REQUEST_ID_HEADER: "validation-request"},
            params={"limit": "not-an-integer"},
        )

    assert_error_contract(
        response,
        code=ERROR_CODE_VALIDATION_ERROR,
        message="Request validation failed",
        request_id="validation-request",
        status_code=422,
    )
    assert "not-an-integer" not in response.text


def test_unexpected_error_uses_safe_project_contract(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")
    app = create_app()
    add_error_test_routes(app)

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get(
            "/test/unexpected",
            headers={REQUEST_ID_HEADER: "unexpected-request"},
        )

    assert_error_contract(
        response,
        code=ERROR_CODE_INTERNAL_SERVER_ERROR,
        message="Internal server error",
        request_id="unexpected-request",
        status_code=500,
    )
    assert "secret internal detail" not in response.text


def test_unexpected_error_logs_one_structured_error(monkeypatch, caplog) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")
    app = create_app()
    add_error_test_routes(app)

    with caplog.at_level(logging.ERROR):
        with TestClient(app, raise_server_exceptions=False) as client:
            caplog.clear()
            response = client.get(
                "/test/unexpected",
                headers={REQUEST_ID_HEADER: "unexpected-log-request"},
            )

    assert response.status_code == 500

    records = [
        record
        for record in caplog.records
        if record.levelno == logging.ERROR
        and record.getMessage() == "Unexpected AI service exception"
    ]
    assert len(records) == 1

    record = records[0]
    assert record.request_id == "unexpected-log-request"
    assert record.context["event"] == "api.unexpected_error"
    assert record.context["errorType"] == "RuntimeError"

    serialized = StructuredJsonFormatter().format(record)
    assert "secret internal detail" not in serialized
    assert "unexpected-log-request" in serialized


def test_internal_health_rejects_missing_key(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")

    with TestClient(create_app()) as client:
        response = client.get("/internal/health")

    assert_error_contract(
        response,
        code=ERROR_CODE_INTERNAL_API_KEY_MISSING,
        message="Missing internal API key",
        status_code=401,
    )


def test_internal_health_rejects_wrong_key(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")

    with TestClient(create_app()) as client:
        response = client.get(
            "/internal/health",
            headers={"X-Internal-API-Key": "wrong-key"},
        )

    assert_error_contract(
        response,
        code=ERROR_CODE_INTERNAL_API_KEY_INVALID,
        message="Invalid internal API key",
        status_code=403,
    )


def test_internal_health_accepts_correct_key(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")

    with TestClient(create_app()) as client:
        response = client.get(
            "/internal/health",
            headers={
                REQUEST_ID_HEADER: "internal-health-request",
                "X-Internal-API-Key": "expected-key",
            },
        )

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers[REQUEST_ID_HEADER] == "internal-health-request"


def test_internal_health_logs_request_id(monkeypatch, caplog) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")

    with caplog.at_level(logging.INFO):
        with TestClient(create_app()) as client:
            caplog.clear()
            response = client.get(
                "/internal/health",
                headers={
                    REQUEST_ID_HEADER: "internal-health-log-request",
                    "X-Internal-API-Key": "expected-key",
                },
            )

    assert response.status_code == 200

    records = [
        record
        for record in caplog.records
        if record.levelno == logging.INFO
        and record.getMessage() == "AI service request completed"
    ]
    assert len(records) == 1

    record = records[0]
    assert record.request_id == "internal-health-log-request"
    assert record.context == {
        "event": "http.request",
        "method": "GET",
        "path": "/internal/health",
        "statusCode": 200,
    }

    serialized = StructuredJsonFormatter().format(record)
    assert '"requestId":"internal-health-log-request"' in serialized
    assert "expected-key" not in serialized


def test_openapi_contract_contains_stage_2_6_endpoints(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_INTERNAL_API_KEY", "expected-key")

    with TestClient(create_app()) as client:
        response = client.get("/openapi.json")

    assert response.status_code == 200

    contract = response.json()
    assert "/health" in contract["paths"]
    assert "/internal/health" in contract["paths"]
    assert "APIKeyHeader" in contract["components"]["securitySchemes"]
