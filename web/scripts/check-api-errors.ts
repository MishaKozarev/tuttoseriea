import {
  API_ERROR_CODES,
  ApplicationError,
  REQUEST_ID_HEADER,
  createApiErrorResponse,
  normalizeRequestId,
  serializeApiError,
} from "../src/api/errors";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function readErrorResponse(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; requestId: string };
  };
}

const expectedError = new ApplicationError({
  code: "CONFLICT",
  message: "Resource already exists",
  requestId: "application-request-id",
  status: 409,
});

const expectedSerialized = serializeApiError(
  expectedError,
  new Headers({ [REQUEST_ID_HEADER]: "incoming-request-id" }),
);

assert(expectedSerialized.status === 409, "ApplicationError status was not preserved");
assert(
  expectedSerialized.body.error.code === "CONFLICT",
  "ApplicationError code was not preserved",
);
assert(
  expectedSerialized.body.error.message === "Resource already exists",
  "ApplicationError safe message was not preserved",
);
assert(
  expectedSerialized.body.error.requestId === "incoming-request-id",
  "Incoming requestId should take precedence at the Web boundary",
);

const errorRequestIdSerialized = serializeApiError(expectedError);
assert(
  errorRequestIdSerialized.body.error.requestId === "application-request-id",
  "ApplicationError requestId should be reused when there is no incoming request",
);

const unexpectedSerialized = serializeApiError(
  new Error("database password=secret stack trace"),
  "safe-request-id",
);

assert(unexpectedSerialized.status === 500, "Unexpected errors must serialize as 500");
assert(
  unexpectedSerialized.body.error.code === API_ERROR_CODES.internalServerError,
  "Unexpected errors must use the stable internal error code",
);
assert(
  unexpectedSerialized.body.error.message === "Internal server error",
  "Unexpected errors must use a generic safe message",
);
assert(
  !JSON.stringify(unexpectedSerialized.body).includes("password=secret"),
  "Unexpected error details leaked into the response body",
);

const generatedRequestId = serializeApiError(
  new Error("boom"),
  new Headers({ [REQUEST_ID_HEADER]: "invalid request id with spaces" }),
).body.error.requestId;

assert(
  normalizeRequestId(generatedRequestId) === generatedRequestId,
  "Invalid incoming requestId should be replaced with a valid fallback",
);

async function main() {
  const response = createApiErrorResponse(
    new ApplicationError({
      code: API_ERROR_CODES.validationError,
      message: "Request validation failed",
      requestId: "response-request-id",
      status: 422,
    }),
  );
  const responseBody = await readErrorResponse(response);

  assert(response.status === 422, "API error response should preserve status");
  assert(
    response.headers.get(REQUEST_ID_HEADER) === "response-request-id",
    "API error response should expose the same requestId header",
  );
  assert(
    responseBody.error.requestId === "response-request-id",
    "API error response body should expose the same requestId",
  );

  console.log("api_error_check=passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
