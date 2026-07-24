import { describe, expect, it } from "vitest";
import { loadProviderRuntimeConfig } from "./runtime-config.js";

describe("loadProviderRuntimeConfig", () => {
  it("uses safe mock-first defaults for local development", () => {
    const config = loadProviderRuntimeConfig({});

    expect(config).toMatchObject({
      mode: "mock",
      allowMockFallback: true,
      requestTimeoutMs: 10_000,
      maxProvidersPerRequest: 2,
      providers: {
        mock: { enabled: true, configured: true },
        grailed: {
          enabled: false,
          configured: true,
          baseUrl: "https://www.grailed.com",
          scrapingAllowed: false,
          requestTimeoutMs: 5_000,
          minRequestIntervalMs: 3_000,
          maxResultsPerSearch: 24,
          userAgent: "ClosetSearchBot/0.1 contact:<project-contact-email>",
        },
      },
    });
  });

  it("fails closed instead of silently enabling mock inventory in production", () => {
    const config = loadProviderRuntimeConfig({
      NODE_ENV: "production",
      PROVIDER_ALLOW_MOCK_FALLBACK: "true",
    });

    expect(config.mode).toBe("real");
    expect(config.allowMockFallback).toBe(false);
    expect(config.providers.mock.enabled).toBe(false);
  });

  it("parses Grailed scraping flags, pacing, and timeout settings", () => {
    const config = loadProviderRuntimeConfig({
      PROVIDER_RUNTIME_MODE: "real",
      PROVIDER_ALLOW_MOCK_FALLBACK: "false",
      PROVIDER_REQUEST_TIMEOUT_MS: "2500",
      PROVIDER_MAX_ACTIVE_PROVIDERS: "4",
      PROVIDER_MOCK_ENABLED: "false",
      GRAILED_PROVIDER_ENABLED: "true",
      GRAILED_SCRAPING_ALLOWED: "true",
      GRAILED_BASE_URL: " https://www.grailed.com ",
      GRAILED_REQUEST_TIMEOUT_MS: "4200",
      GRAILED_MIN_REQUEST_INTERVAL_MS: "4500",
      GRAILED_MAX_RESULTS_PER_SEARCH: "18",
      GRAILED_USER_AGENT: " ClosetSearchBot/0.1 contact:team@example.com ",
    });

    expect(config.mode).toBe("real");
    expect(config.allowMockFallback).toBe(false);
    expect(config.requestTimeoutMs).toBe(2500);
    expect(config.maxProvidersPerRequest).toBe(4);
    expect(config.providers.mock.enabled).toBe(false);
    expect(config.providers.grailed).toEqual({
      enabled: true,
      configured: true,
      baseUrl: "https://www.grailed.com",
      scrapingAllowed: true,
      requestTimeoutMs: 4200,
      minRequestIntervalMs: 4500,
      maxResultsPerSearch: 18,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });
  });
});
