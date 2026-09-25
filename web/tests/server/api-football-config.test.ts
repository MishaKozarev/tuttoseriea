import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ApiFootballConfigError,
  getApiFootballConfig,
  getApiFootballRealProviderConfig,
} from "@/src/football/api-football";

describe("API-Football provider configuration", () => {
  it("does not require a provider key for ordinary configuration", () => {
    const config = getApiFootballConfig({});

    expect(config.realProviderEnabled).toBe(false);
    expect(config.hasApiKey).toBe(false);
    expect(config.baseUrl.toString()).toBe("https://v3.football.api-sports.io/");
    expect(config.timeoutMs).toBe(10_000);
  });

  it("does not enable real provider calls merely because a key exists", () => {
    const secret = "test-secret-that-must-not-leak";
    const config = getApiFootballConfig({
      API_FOOTBALL_KEY: secret,
    });

    expect(config.realProviderEnabled).toBe(false);
    expect(config.hasApiKey).toBe(true);
    expect(config).not.toHaveProperty("apiKey");
    expect(() =>
      getApiFootballRealProviderConfig({
        API_FOOTBALL_KEY: secret,
      }),
    ).toThrow(/API_FOOTBALL_ENABLE_REAL=true/);
  });

  it("requires a key only after explicit real-provider opt-in", () => {
    expect(() =>
      getApiFootballRealProviderConfig({
        API_FOOTBALL_ENABLE_REAL: "true",
      }),
    ).toThrow(/API_FOOTBALL_KEY is required/);

    expect(
      getApiFootballRealProviderConfig({
        API_FOOTBALL_ENABLE_REAL: "true",
        API_FOOTBALL_KEY: "local-test-key",
      }),
    ).toMatchObject({
      apiKey: "local-test-key",
      timeoutMs: 10_000,
    });
  });

  it("supports safe test base URL and timeout overrides", () => {
    const config = getApiFootballConfig({
      API_FOOTBALL_BASE_URL: "http://127.0.0.1:4010/provider/",
      API_FOOTBALL_TIMEOUT_MS: "250",
    });

    expect(config.baseUrl.toString()).toBe("http://127.0.0.1:4010/provider/");
    expect(config.timeoutMs).toBe(250);
  });

  it("fails safely on invalid provider configuration without exposing secrets", () => {
    const secret = "never-print-this-provider-key";

    expect(() =>
      getApiFootballConfig({
        API_FOOTBALL_ENABLE_REAL: "sometimes",
        API_FOOTBALL_KEY: secret,
      }),
    ).toThrow(ApiFootballConfigError);

    try {
      getApiFootballConfig({
        API_FOOTBALL_ENABLE_REAL: "sometimes",
        API_FOOTBALL_KEY: secret,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
