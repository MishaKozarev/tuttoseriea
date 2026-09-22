import {
  API_ERROR_CODES,
  ApplicationError,
  REQUEST_ID_HEADER,
  normalizeRequestId,
  serializeApiError,
} from "../src/api/errors";
import { buildAiServiceUrl, getAiServiceInternalHealth } from "../src/ai-service/client";

const INTERNAL_API_KEY_HEADER = "X-Internal-API-Key";

type CapturedLog = {
  context?: Record<string, unknown>;
  level: string;
  message: string;
  requestId: string | null;
  service: string;
  timestamp: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function configureRuntimeEnv() {
  process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
  process.env.AI_SERVICE_INTERNAL_API_KEY = "local-contract-test-key";
}

async function withMockedFetch(
  fetchMock: typeof fetch,
  operation: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;

  try {
    await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function captureStderrLogs(operation: () => Promise<void>): Promise<CapturedLog[]> {
  const originalWrite = process.stderr.write;
  let output = "";

  process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

    const callback = args.find((entry): entry is () => void => typeof entry === "function");
    callback?.();

    return true;
  }) as typeof process.stderr.write;

  try {
    await operation();
  } finally {
    process.stderr.write = originalWrite;
  }

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedLog);
}

function assertAiServiceWarnLog(
  logs: CapturedLog[],
  expected: { event: string; requestId: string | undefined },
): void {
  assert(logs.length === 1, `Expected one AI service warning log for ${expected.event}`);

  const [log] = logs;
  const serialized = JSON.stringify(log);

  assert(log.level === "warn", "AI service failure should log as warn");
  assert(log.service === "web", "AI service warning should be emitted by web");
  assert(log.requestId === expected.requestId, "AI service warning lost requestId");
  assert(log.context?.event === expected.event, `Expected event ${expected.event}`);
  assert(!serialized.includes("secret"), "AI service warning leaked upstream details");
  assert(!serialized.includes("Traceback"), "AI service warning leaked upstream traceback");
}

async function captureApplicationError(
  operation: () => Promise<unknown>,
): Promise<ApplicationError> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof ApplicationError, "Expected an ApplicationError");
    return error;
  }

  throw new Error("Operation did not throw");
}

async function assertAiServiceError(
  operation: () => Promise<unknown>,
  expected: { code: string; requestId?: string; status: number },
): Promise<ApplicationError> {
  const error = await captureApplicationError(operation);

  assert(error.status === expected.status, `Expected status ${expected.status}`);
  assert(error.code === expected.code, `Expected code ${expected.code}`);

  if (expected.requestId) {
    assert(error.requestId === expected.requestId, "ApplicationError lost requestId");
  } else {
    assert(
      normalizeRequestId(error.requestId) === error.requestId,
      "ApplicationError should contain a generated requestId",
    );
  }

  const serialized = serializeApiError(error).body;
  const serializedText = JSON.stringify(serialized);

  assert(
    serialized.error.requestId === error.requestId,
    "Serialized error should reuse the ApplicationError requestId",
  );
  assert(!serializedText.includes("secret"), "Internal or upstream details leaked");
  assert(!serializedText.includes("Traceback"), "Upstream stack details leaked");

  return error;
}

async function checkMockedClient() {
  const expectedApiKey = "local-contract-test-key";
  const expectedUrl = "http://127.0.0.1:8000/internal/health";
  const expectedRequestId = "incoming-web-request";

  configureRuntimeEnv();

  const builtUrl = buildAiServiceUrl("/internal/health").toString();
  assert(builtUrl === expectedUrl, `Unexpected AI service URL: ${builtUrl}`);

  let fetchCalled = false;

  await withMockedFetch(async (input, init) => {
    fetchCalled = true;

    assert(input instanceof URL, "AI service client should call fetch with URL");
    assert(input.toString() === expectedUrl, `Unexpected fetch URL: ${input}`);
    assert(init?.cache === "no-store", "AI service requests must not be cached");

    const headers = new Headers(init?.headers);
    assert(
      headers.get(INTERNAL_API_KEY_HEADER) === expectedApiKey,
      "AI service request is missing the internal API key header",
    );
    assert(
      headers.get(REQUEST_ID_HEADER) === expectedRequestId,
      "AI service request is missing the propagated requestId",
    );

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }, async () => {
    const result = await getAiServiceInternalHealth({
      headers: new Headers({ [REQUEST_ID_HEADER]: expectedRequestId }),
    });

    assert(fetchCalled, "AI service client did not call fetch");
    assert(result.status === "ok", "Unexpected AI service response body");
  });
}

async function checkTimeoutMapping() {
  configureRuntimeEnv();

  await withMockedFetch(async (_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;

      assert(signal instanceof AbortSignal, "AI service timeout should use AbortSignal");
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("secret timeout detail", "AbortError")),
        { once: true },
      );
    });
  }, async () => {
    let error: ApplicationError | undefined;
    const logs = await captureStderrLogs(async () => {
      error = await assertAiServiceError(
        () =>
          getAiServiceInternalHealth({
            requestId: "timeout-request",
            timeoutMs: 1,
          }),
        {
          code: API_ERROR_CODES.aiServiceTimeout,
          requestId: "timeout-request",
          status: 504,
        },
      );
    });

    assert(error, "Timeout mapping did not capture error");
    assertAiServiceWarnLog(logs, {
      event: "ai_service.timeout",
      requestId: error.requestId,
    });
  });
}

async function checkNetworkMapping() {
  configureRuntimeEnv();

  await withMockedFetch(async () => {
    throw new TypeError("secret network detail");
  }, async () => {
    let error: ApplicationError | undefined;
    const logs = await captureStderrLogs(async () => {
      error = await assertAiServiceError(() => getAiServiceInternalHealth(), {
        code: API_ERROR_CODES.aiServiceNetworkError,
        status: 502,
      });
    });

    assert(error, "Network mapping did not capture error");
    assertAiServiceWarnLog(logs, {
      event: "ai_service.network_error",
      requestId: error.requestId,
    });
  });
}

async function checkUpstream5xxMapping() {
  configureRuntimeEnv();

  await withMockedFetch(async () => {
    return new Response(JSON.stringify({ detail: "Traceback secret-upstream" }), {
      headers: { "content-type": "application/json" },
      status: 500,
    });
  }, async () => {
    let error: ApplicationError | undefined;
    const logs = await captureStderrLogs(async () => {
      error = await assertAiServiceError(
        () => getAiServiceInternalHealth({ requestId: "upstream-5xx-request" }),
        {
          code: API_ERROR_CODES.aiServiceUnavailable,
          requestId: "upstream-5xx-request",
          status: 502,
        },
      );
    });

    assert(error, "AI 5xx mapping did not capture error");
    assertAiServiceWarnLog(logs, {
      event: "ai_service.upstream_5xx",
      requestId: error.requestId,
    });
  });
}

async function checkMapped4xxMapping() {
  configureRuntimeEnv();

  await withMockedFetch(async () => {
    return new Response(JSON.stringify({ detail: "secret validation detail" }), {
      headers: { "content-type": "application/json" },
      status: 422,
    });
  }, async () => {
    await assertAiServiceError(
      () => getAiServiceInternalHealth({ requestId: "mapped-4xx-request" }),
      {
        code: API_ERROR_CODES.aiServiceRequestRejected,
        requestId: "mapped-4xx-request",
        status: 422,
      },
    );
  });
}

async function checkMalformedUpstreamMapping() {
  configureRuntimeEnv();

  await withMockedFetch(async () => {
    return new Response("not json secret-response", {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }, async () => {
    let error: ApplicationError | undefined;
    const logs = await captureStderrLogs(async () => {
      error = await assertAiServiceError(
        () => getAiServiceInternalHealth({ requestId: "malformed-request" }),
        {
          code: API_ERROR_CODES.aiServiceBadResponse,
          requestId: "malformed-request",
          status: 502,
        },
      );
    });

    assert(error, "Malformed response mapping did not capture error");
    assertAiServiceWarnLog(logs, {
      event: "ai_service.invalid_json",
      requestId: error.requestId,
    });
  });
}

async function checkUnexpectedUpstreamShapeMapping() {
  configureRuntimeEnv();

  await withMockedFetch(async () => {
    return new Response(JSON.stringify({ secret: "upstream-detail", status: "bad" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }, async () => {
    let error: ApplicationError | undefined;
    const logs = await captureStderrLogs(async () => {
      error = await assertAiServiceError(
        () => getAiServiceInternalHealth({ requestId: "unexpected-shape-request" }),
        {
          code: API_ERROR_CODES.aiServiceBadResponse,
          requestId: "unexpected-shape-request",
          status: 502,
        },
      );
    });

    assert(error, "Unexpected shape mapping did not capture error");
    assertAiServiceWarnLog(logs, {
      event: "ai_service.unexpected_response",
      requestId: error.requestId,
    });
  });
}

async function main() {
  await checkMockedClient();
  await checkTimeoutMapping();
  await checkNetworkMapping();
  await checkUpstream5xxMapping();
  await checkMapped4xxMapping();
  await checkMalformedUpstreamMapping();
  await checkUnexpectedUpstreamShapeMapping();
}

main()
  .then(() => {
    console.log("ai_service_client_check=passed");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
