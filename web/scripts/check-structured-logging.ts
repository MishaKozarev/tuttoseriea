import {
  API_ERROR_CODES,
  REQUEST_ID_HEADER,
  createApiErrorResponse,
} from "../src/api/errors";
import { logger } from "../src/logging/logger";

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

async function captureStream(
  streamName: "stderr" | "stdout",
  operation: () => Promise<void> | void,
): Promise<string> {
  const stream = process[streamName];
  const originalWrite = stream.write;
  let output = "";

  stream.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

    const callback = args.find((entry): entry is () => void => typeof entry === "function");
    callback?.();

    return true;
  }) as typeof stream.write;

  try {
    await operation();
  } finally {
    stream.write = originalWrite;
  }

  return output;
}

function parseLogLines(output: string): CapturedLog[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedLog);
}

function assertCanonicalLogShape(entry: CapturedLog): void {
  assert(typeof entry.timestamp === "string", "Log entry must include timestamp");
  assert(typeof entry.level === "string", "Log entry must include level");
  assert(typeof entry.message === "string", "Log entry must include message");
  assert(entry.service === "web", "Web log entry must include service=web");
  assert("requestId" in entry, "Log entry must include requestId");
}

async function main() {
  const stdout = await captureStream("stdout", () => {
    logger.info("Web logging smoke", {
      context: { event: "logging.smoke" },
    });
  });
  const stdoutLogs = parseLogLines(stdout);

  assert(stdoutLogs.length === 1, "Expected one stdout log");
  assertCanonicalLogShape(stdoutLogs[0]);
  assert(stdoutLogs[0].level === "info", "Expected info log level");
  assert(stdoutLogs[0].requestId === null, "Non-request logs should use requestId=null");

  const stderr = await captureStream("stderr", () => {
    logger.warn("Web logging redaction smoke", {
      context: {
        apiKey: "secret-api-key",
        authorization: "Bearer secret-token",
        cookie: "session=secret-cookie",
        databaseUrl: "postgresql://user:password@127.0.0.1:5432/app",
        nested: {
          password: "secret-password",
        },
        safe: "visible",
      },
      requestId: "logging-request",
    });
  });
  const stderrLogs = parseLogLines(stderr);
  const redactedText = JSON.stringify(stderrLogs[0]);

  assert(stderrLogs.length === 1, "Expected one stderr log");
  assertCanonicalLogShape(stderrLogs[0]);
  assert(stderrLogs[0].level === "warn", "Expected warn log level");
  assert(stderrLogs[0].requestId === "logging-request", "requestId was not preserved");
  assert(redactedText.includes("visible"), "Safe context should remain visible");
  assert(!redactedText.includes("secret-api-key"), "apiKey was not redacted");
  assert(!redactedText.includes("secret-token"), "authorization was not redacted");
  assert(!redactedText.includes("secret-cookie"), "cookie was not redacted");
  assert(!redactedText.includes("secret-password"), "password was not redacted");
  assert(!redactedText.includes("postgresql://"), "databaseUrl was not redacted");

  const unexpectedOutput = await captureStream("stderr", async () => {
    const response = createApiErrorResponse(
      new Error("database password=secret stack trace"),
      new Headers({ [REQUEST_ID_HEADER]: "unexpected-api-request" }),
    );
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };

    assert(response.status === 500, "Unexpected API error response status changed");
    assert(
      body.error.code === API_ERROR_CODES.internalServerError,
      "Unexpected API error response code changed",
    );
    assert(
      body.error.message === "Internal server error",
      "Unexpected API error response message changed",
    );
    assert(
      body.error.requestId === "unexpected-api-request",
      "Unexpected API error response requestId changed",
    );
  });
  const unexpectedLogs = parseLogLines(unexpectedOutput);
  const unexpectedText = JSON.stringify(unexpectedLogs[0]);

  assert(unexpectedLogs.length === 1, "Unexpected API error should log once");
  assertCanonicalLogShape(unexpectedLogs[0]);
  assert(unexpectedLogs[0].level === "error", "Unexpected API error should log as error");
  assert(
    unexpectedLogs[0].requestId === "unexpected-api-request",
    "Unexpected API error log lost requestId",
  );
  assert(!unexpectedText.includes("password=secret"), "Unexpected error details leaked");

  console.log("structured_logging_check=passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
