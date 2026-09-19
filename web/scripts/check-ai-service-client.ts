import { buildAiServiceUrl, getAiServiceInternalHealth } from "../src/ai-service/client";

const INTERNAL_API_KEY_HEADER = "X-Internal-API-Key";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function checkMockedClient() {
  const expectedApiKey = "local-contract-test-key";
  const expectedUrl = "http://127.0.0.1:8000/internal/health";

  process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
  process.env.AI_SERVICE_INTERNAL_API_KEY = expectedApiKey;

  const builtUrl = buildAiServiceUrl("/internal/health").toString();
  assert(builtUrl === expectedUrl, `Unexpected AI service URL: ${builtUrl}`);

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  globalThis.fetch = async (input, init) => {
    fetchCalled = true;

    assert(input instanceof URL, "AI service client should call fetch with URL");
    assert(input.toString() === expectedUrl, `Unexpected fetch URL: ${input}`);
    assert(init?.cache === "no-store", "AI service requests must not be cached");

    const headers = new Headers(init?.headers);
    assert(
      headers.get(INTERNAL_API_KEY_HEADER) === expectedApiKey,
      "AI service request is missing the internal API key header",
    );

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };

  try {
    const result = await getAiServiceInternalHealth();

    assert(fetchCalled, "AI service client did not call fetch");
    assert(result.status === "ok", "Unexpected AI service response body");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

checkMockedClient()
  .then(() => {
    console.log("ai_service_client_check=passed");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
