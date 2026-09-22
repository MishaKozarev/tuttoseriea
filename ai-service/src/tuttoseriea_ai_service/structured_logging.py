import json
import logging
import math
import re
import sys
from datetime import UTC, datetime
from typing import Any

SERVICE = "ai-service"
REDACTED = "[REDACTED]"

_SENSITIVE_KEY_PATTERN = re.compile(
    r"(^|_|\b)(authorization|api[_-]?key|cookie|database[_-]?url|databaseurl|"
    r"connection[_-]?string|connectionstring|password|secret|session|token)($|_|\b)",
    re.IGNORECASE,
)
_CONNECTION_STRING_PATTERN = re.compile(
    r"\b(?:postgres|postgresql|mysql|mariadb|mongodb|redis)://[^\s]+",
    re.IGNORECASE,
)


def _level_name(record: logging.LogRecord) -> str:
    if record.levelno == logging.WARNING:
        return "warn"

    return record.levelname.lower()


def _is_sensitive_key(key: str | None) -> bool:
    return key is not None and _SENSITIVE_KEY_PATTERN.search(key) is not None


def _sanitize_string(value: str, key: str | None = None) -> str:
    if _is_sensitive_key(key) or _CONNECTION_STRING_PATTERN.search(value) is not None:
        return REDACTED

    return value


def sanitize_log_value(
    value: Any,
    key: str | None = None,
    seen: set[int] | None = None,
) -> Any:
    if value is None or isinstance(value, bool | int):
        return value

    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)

    if isinstance(value, str):
        return _sanitize_string(value, key)

    if isinstance(value, BaseException):
        return {"name": type(value).__name__}

    if isinstance(value, bytes):
        return "<bytes>"

    active_seen = set() if seen is None else seen

    if isinstance(value, dict):
        value_id = id(value)

        if value_id in active_seen:
            return "[Circular]"

        active_seen.add(value_id)
        sanitized = {
            str(entry_key): sanitize_log_value(entry_value, str(entry_key), active_seen)
            for entry_key, entry_value in sorted(
                value.items(),
                key=lambda item: str(item[0]),
            )
        }
        active_seen.remove(value_id)
        return sanitized

    if isinstance(value, list | tuple | set):
        value_id = id(value)

        if value_id in active_seen:
            return "[Circular]"

        active_seen.add(value_id)
        sanitized_sequence = [
            sanitize_log_value(entry, key, active_seen) for entry in value
        ]
        active_seen.remove(value_id)
        return sanitized_sequence

    return str(value)


class StructuredJsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        request_id = getattr(record, "request_id", None)
        context = getattr(record, "context", None)

        entry: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": _level_name(record),
            "message": record.getMessage(),
            "service": SERVICE,
            "requestId": request_id if isinstance(request_id, str) else None,
        }

        if context is not None:
            entry["context"] = sanitize_log_value(context)

        return json.dumps(entry, ensure_ascii=False, separators=(",", ":"))


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(StructuredJsonFormatter())

    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(logging.INFO)

    for logger_name in ("uvicorn", "uvicorn.error"):
        framework_logger = logging.getLogger(logger_name)
        framework_logger.handlers = []
        framework_logger.propagate = True
        framework_logger.setLevel(logging.INFO)

    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers = []
    access_logger.propagate = False
    access_logger.disabled = True


def exception_context(exception: Exception) -> dict[str, str]:
    return {
        "errorType": type(exception).__name__,
    }
