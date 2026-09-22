import logging
import re
from http import HTTPStatus
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

REQUEST_ID_HEADER = "X-Request-ID"

ERROR_CODE_FORBIDDEN = "FORBIDDEN"
ERROR_CODE_INTERNAL_API_KEY_INVALID = "INTERNAL_API_KEY_INVALID"
ERROR_CODE_INTERNAL_API_KEY_MISSING = "INTERNAL_API_KEY_MISSING"
ERROR_CODE_INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR"
ERROR_CODE_METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
ERROR_CODE_NOT_FOUND = "NOT_FOUND"
ERROR_CODE_UNAUTHORIZED = "UNAUTHORIZED"
ERROR_CODE_VALIDATION_ERROR = "VALIDATION_ERROR"

_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_INTERNAL_ERROR_MESSAGE = "Internal server error"
_VALIDATION_ERROR_MESSAGE = "Request validation failed"

logger = logging.getLogger(__name__)


class ApplicationError(Exception):
    def __init__(self, *, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def normalize_request_id(value: str | None) -> str | None:
    request_id = value.strip() if value is not None else None

    if not request_id or not _REQUEST_ID_PATTERN.fullmatch(request_id):
        return None

    return request_id


def create_request_id() -> str:
    return str(uuid4())


def get_request_id(request: Request) -> str:
    state_request_id = normalize_request_id(getattr(request.state, "request_id", None))

    if state_request_id is not None:
        return state_request_id

    request_id = normalize_request_id(
        request.headers.get(REQUEST_ID_HEADER),
    ) or create_request_id()
    request.state.request_id = request_id
    return request_id


def error_response(
    request: Request,
    *,
    code: str,
    message: str,
    status_code: int,
) -> JSONResponse:
    request_id = get_request_id(request)

    return JSONResponse(
        {"error": {"code": code, "message": message, "requestId": request_id}},
        headers={REQUEST_ID_HEADER: request_id},
        status_code=status_code,
    )


def _http_error_code(status_code: int) -> str:
    return {
        status.HTTP_401_UNAUTHORIZED: ERROR_CODE_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN: ERROR_CODE_FORBIDDEN,
        status.HTTP_404_NOT_FOUND: ERROR_CODE_NOT_FOUND,
        status.HTTP_405_METHOD_NOT_ALLOWED: ERROR_CODE_METHOD_NOT_ALLOWED,
    }.get(status_code, f"HTTP_{status_code}")


def _http_error_message(status_code: int) -> str:
    message = {
        status.HTTP_401_UNAUTHORIZED: "Unauthorized",
        status.HTTP_403_FORBIDDEN: "Forbidden",
        status.HTTP_404_NOT_FOUND: "Resource not found",
        status.HTTP_405_METHOD_NOT_ALLOWED: "Method not allowed",
    }.get(status_code)

    if message is not None:
        return message

    try:
        return HTTPStatus(status_code).phrase
    except ValueError:
        return "HTTP error"


async def request_id_middleware(request: Request, call_next: Any) -> Any:
    request_id = normalize_request_id(
        request.headers.get(REQUEST_ID_HEADER),
    ) or create_request_id()
    request.state.request_id = request_id

    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response


async def application_error_handler(
    request: Request,
    exception: ApplicationError,
) -> JSONResponse:
    return error_response(
        request,
        code=exception.code,
        message=exception.message,
        status_code=exception.status_code,
    )


async def validation_error_handler(
    request: Request,
    _exception: RequestValidationError,
) -> JSONResponse:
    return error_response(
        request,
        code=ERROR_CODE_VALIDATION_ERROR,
        message=_VALIDATION_ERROR_MESSAGE,
        status_code=422,
    )


async def http_exception_handler(
    request: Request,
    exception: StarletteHTTPException,
) -> JSONResponse:
    return error_response(
        request,
        code=_http_error_code(exception.status_code),
        message=_http_error_message(exception.status_code),
        status_code=exception.status_code,
    )


async def unexpected_exception_handler(
    request: Request,
    exception: Exception,
) -> JSONResponse:
    request_id = get_request_id(request)
    logger.error(
        "Unexpected AI service exception",
        extra={"requestId": request_id},
        exc_info=(type(exception), exception, exception.__traceback__),
    )

    return error_response(
        request,
        code=ERROR_CODE_INTERNAL_SERVER_ERROR,
        message=_INTERNAL_ERROR_MESSAGE,
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


def register_error_handling(app: FastAPI) -> None:
    app.middleware("http")(request_id_middleware)
    app.add_exception_handler(ApplicationError, application_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unexpected_exception_handler)
