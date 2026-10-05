import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createApiFootballClient,
  type ApiFootballClientOptions,
  type ApiFootballEnvelope,
} from "@/src/football/api-football";

const config = {
  apiKey: "local-test-key",
  baseUrl: new URL("https://v3.football.api-sports.io/"),
  timeoutMs: 50,
};

function envelope<TResponse>(
  response: TResponse,
  overrides: Partial<ApiFootballEnvelope<TResponse>> = {},
): ApiFootballEnvelope<TResponse> {
  return {
    errors: [],
    get: "leagues",
    paging: {
      current: 1,
      total: 1,
    },
    parameters: {},
    response,
    results: Array.isArray(response) ? response.length : 1,
    ...overrides,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    status,
  });
}

function createClient(
  fetchImpl: NonNullable<ApiFootballClientOptions["fetch"]>,
  options: Omit<ApiFootballClientOptions, "config" | "fetch"> = {},
) {
  return createApiFootballClient({
    backoffBaseMs: 10,
    config,
    fetch: fetchImpl,
    jitter: () => 0,
    sleep: async () => {},
    ...options,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("API-Football HTTP client", () => {
  it("builds authenticated requests against the configured base URL", async () => {
    let requestedUrl = "";
    let requestedHeaders = new Headers();
    const client = createClient(async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);

      return jsonResponse(200, envelope([{ league: { id: 135 } }]));
    });

    const result = await client.get("leagues", {
      id: 135,
      season: 2026,
    });

    expect(result.ok).toBe(true);
    expect(client.getRequestAttemptCount()).toBe(1);
    expect(requestedUrl).toBe(
      "https://v3.football.api-sports.io/leagues?id=135&season=2026",
    );
    expect(requestedHeaders.get("x-apisports-key")).toBe("local-test-key");
    expect(requestedHeaders.get("accept")).toBe("application/json");
  });

  it("treats results=0 as a successful empty response", async () => {
    const client = createClient(async () =>
      jsonResponse(200, envelope([], { results: 0 })),
    );

    const result = await client.get<unknown[]>("fixtures", {
      league: 135,
    });

    expect(result).toMatchObject({
      ok: true,
      results: 0,
      data: [],
      paging: {
        current: 1,
        total: 1,
      },
    });
  });

  it("retries retryable server errors with bounded attempts", async () => {
    let attempts = 0;
    const sleepMs: number[] = [];
    const client = createApiFootballClient({
      backoffBaseMs: 25,
      config,
      fetch: async () => {
        attempts += 1;

        if (attempts < 3) {
          return jsonResponse(503, { error: "temporary" });
        }

        return jsonResponse(200, envelope([{ ok: true }]));
      },
      jitter: () => 0,
      sleep: async (ms) => {
        sleepMs.push(ms);
      },
    });

    const result = await client.get("leagues");

    expect(result.ok).toBe(true);
    expect(attempts).toBe(3);
    expect(client.getRequestAttemptCount()).toBe(3);
    expect(sleepMs).toEqual([25, 50]);
  });

  it("counts every exhausted retry attempt", async () => {
    const client = createClient(
      async () => jsonResponse(503, { error: "temporary" }),
      { maxAttempts: 3 },
    );

    const result = await client.get("standings");

    expect(result).toMatchObject({
      ok: false,
      error: {
        attempts: 3,
        code: "http_server_error",
        retryable: true,
      },
    });
    expect(client.getRequestAttemptCount()).toBe(3);
  });

  it("scopes request counters to one client instance and starts at zero", async () => {
    const first = createClient(async () => jsonResponse(200, envelope([])));
    const second = createClient(async () => jsonResponse(200, envelope([])));

    expect(first.getRequestAttemptCount()).toBe(0);
    expect(second.getRequestAttemptCount()).toBe(0);

    await first.get("standings");

    expect(first.getRequestAttemptCount()).toBe(1);
    expect(second.getRequestAttemptCount()).toBe(0);
  });

  it("does not retry ordinary non-rate-limit client errors", async () => {
    let attempts = 0;
    const client = createClient(async () => {
      attempts += 1;

      return jsonResponse(400, { error: "bad request" });
    });

    const result = await client.get("leagues");

    expect(result).toMatchObject({
      ok: false,
      error: {
        attempts: 1,
        code: "http_client_error",
        httpStatus: 400,
        retryable: false,
      },
    });
    expect(attempts).toBe(1);
  });

  it("respects Retry-After with a short HTTP retry cap", async () => {
    let attempts = 0;
    const sleepMs: number[] = [];
    const client = createApiFootballClient({
      config,
      fetch: async () => {
        attempts += 1;

        if (attempts === 1) {
          return jsonResponse(429, {}, { "retry-after": "10" });
        }

        return jsonResponse(200, envelope([{ ok: true }]));
      },
      retryAfterCapMs: 2_000,
      sleep: async (ms) => {
        sleepMs.push(ms);
      },
    });

    const result = await client.get("leagues");

    expect(result.ok).toBe(true);
    expect(sleepMs).toEqual([2_000]);
  });

  it("classifies daily quota exhaustion without short HTTP retries", async () => {
    let attempts = 0;
    const client = createClient(async () => {
      attempts += 1;

      return jsonResponse(
        429,
        {},
        {
          "x-ratelimit-requests-limit": "7500",
          "x-ratelimit-requests-remaining": "0",
        },
      );
    });

    const result = await client.get("fixtures");

    expect(result).toMatchObject({
      ok: false,
      error: {
        attempts: 1,
        code: "daily_quota_exhausted",
        rateLimit: {
          scope: "daily",
          daily: {
            limit: 7500,
            remaining: 0,
          },
        },
        retryable: false,
      },
    });
    expect(attempts).toBe(1);
  });

  it("normalizes provider errors and retries only structured retryable provider errors", async () => {
    let attempts = 0;
    const client = createClient(async () => {
      attempts += 1;

      if (attempts === 1) {
        return jsonResponse(200, envelope([], { errors: { timeout: "temporary" } }));
      }

      return jsonResponse(200, envelope([{ ok: true }]));
    });

    const result = await client.get("fixtures");

    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it("recognizes compact provider error objects before validating a success envelope", async () => {
    const client = createClient(async () =>
      jsonResponse(200, {
        errors: { subscription: "request rejected" },
      }),
    );

    const result = await client.get("fixtures/events", { fixture: 1_550_128 });

    expect(result).toMatchObject({
      ok: false,
      error: {
        attempts: 1,
        code: "provider_error",
        retryable: false,
      },
    });
  });

  it("recognizes compact provider error arrays without inventing retry semantics", async () => {
    const client = createClient(async () =>
      jsonResponse(200, {
        errors: ["request rejected"],
      }),
    );

    const result = await client.get("fixtures/lineups", { fixture: 1_550_128 });

    expect(result).toMatchObject({
      ok: false,
      error: {
        attempts: 1,
        code: "provider_error",
        retryable: false,
      },
    });
  });

  it("classifies HTTP 200 provider errors using confirmed minute-limit headers", async () => {
    const client = createClient(
      async () =>
        jsonResponse(
          200,
          { errors: { requests: "request rejected" } },
          {
            "x-ratelimit-limit": "10",
            "x-ratelimit-remaining": "0",
          },
        ),
      { maxAttempts: 1 },
    );

    const result = await client.get("fixtures/events", { fixture: 1_550_128 });

    expect(result).toMatchObject({
      ok: false,
      error: {
        attempts: 1,
        code: "provider_rate_limited",
        retryable: true,
        rateLimit: {
          scope: "minute",
        },
      },
    });
  });

  it("classifies HTTP 200 provider errors using confirmed daily-quota headers", async () => {
    const client = createClient(async () =>
      jsonResponse(
        200,
        { errors: { requests: "request rejected" } },
        {
          "x-ratelimit-requests-limit": "7500",
          "x-ratelimit-requests-remaining": "0",
        },
      ),
    );

    const result = await client.get("fixtures/events", { fixture: 1_550_128 });

    expect(result).toMatchObject({
      ok: false,
      error: {
        attempts: 1,
        code: "daily_quota_exhausted",
        retryable: false,
        rateLimit: {
          scope: "daily",
        },
      },
    });
  });

  it("runs the request gate before every outbound attempt including retries", async () => {
    let attempts = 0;
    const beforeRequestAttempt = vi.fn(async () => undefined);
    const client = createClient(
      async () => {
        attempts += 1;

        return attempts === 1
          ? jsonResponse(503, { error: "temporary" })
          : jsonResponse(200, envelope([]));
      },
      { beforeRequestAttempt },
    );

    await expect(client.get("fixtures/events")).resolves.toMatchObject({ ok: true });
    expect(beforeRequestAttempt).toHaveBeenCalledTimes(2);
    expect(client.getRequestAttemptCount()).toBe(2);
  });

  it("keeps genuinely malformed success payloads terminal", async () => {
    const client = createClient(async () =>
      jsonResponse(200, envelope(null, { errors: [] })),
    );

    const result = await client.get("fixtures/events");

    expect(result).toMatchObject({
      ok: false,
      error: {
        attempts: 1,
        code: "malformed_response",
        retryable: false,
      },
    });
  });

  it("normalizes malformed JSON without retrying or leaking raw payloads", async () => {
    let attempts = 0;
    const client = createClient(async () => {
      attempts += 1;

      return new Response("not-json", {
        status: 200,
      });
    });

    const result = await client.get("fixtures");

    expect(result).toMatchObject({
      ok: false,
      error: {
        attempts: 1,
        code: "malformed_response",
        retryable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("not-json");
    expect(attempts).toBe(1);
  });

  it("returns timeout errors when the configured timeout aborts the request", async () => {
    vi.useFakeTimers();

    const client = createApiFootballClient({
      config: {
        ...config,
        timeoutMs: 10,
      },
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      maxAttempts: 1,
    });

    const pending = client.get("fixtures");

    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: {
        attempts: 1,
        code: "timeout",
        retryable: true,
      },
    });
  });
});
