import { describe, expect, it } from "vitest";
import { loadProviderRuntimeConfig } from "./runtime-config.js";

describe("loadProviderRuntimeConfig", () => {
  it("uses safe mock-first defaults for local development", () => {
    const config = loadProviderRuntimeConfig({});

    expect(config).toMatchObject({
      mode: "mock",
      allowMockFallback: true,
      requestTimeoutMs: 10_000,
      maxProvidersPerRequest: 5,
      providers: {
        mock: { enabled: true, configured: true },
        depop: {
          enabled: false,
          maxResultsPerSearch: 48,
          scrapingAllowed: false,
        },
        grailed: {
          enabled: false,
          configured: true,
          baseUrl: "https://www.grailed.com",
          scrapingAllowed: false,
          requestTimeoutMs: 5_000,
          minRequestIntervalMs: 3_000,
          maxResultsPerSearch: 24,
          maxConcurrency: 2,
          maxRetries: 2,
          baseBackoffMs: 250,
          maxRetryAfterMs: 60_000,
          circuitBreakerFailureThreshold: 5,
          circuitBreakerCooldownMs: 30_000,
          userAgent: "ClosetSearchBot/0.1 contact:<project-contact-email>",
        },
        mercariJp: {
          enabled: false,
          maxResultsPerSearch: 48,
          scrapingAllowed: false,
        },
        yahooAuctionsJp: {
          enabled: false,
          maxResultsPerSearch: 48,
          scrapingAllowed: false,
        },
      },
    });
  });

  it("loads every authorized marketplace independently and keeps references out of status defaults", () => {
    const config = loadProviderRuntimeConfig({
      PROVIDER_RUNTIME_MODE: "real",
      PROVIDER_MAX_ACTIVE_PROVIDERS: "5",
      DEPOP_SCRAPING_ALLOWED: "true",
      DEPOP_AUTHORIZATION_REFERENCE: "depop-approval-2026",
      DEPOP_MAX_RESULTS_PER_SEARCH: "12",
      YAHOO_AUCTIONS_JP_SCRAPING_ALLOWED: "true",
      YAHOO_AUCTIONS_JP_AUTHORIZATION_REFERENCE: "yahoo-jp-approval-2026",
      YAHOO_AUCTIONS_JP_MAX_RESULTS_PER_SEARCH: "13",
      MERCARI_JP_SCRAPING_ALLOWED: "true",
      MERCARI_JP_AUTHORIZATION_REFERENCE: "mercari-jp-approval-2026",
      MERCARI_JP_MAX_RESULTS_PER_SEARCH: "14",
      EBAY_PROVIDER_ENABLED: "true",
      EBAY_CLIENT_ID: "client-id",
      EBAY_CLIENT_SECRET: "client-secret",
      EBAY_AUTHORIZATION_REFERENCE: "ebay-buy-approval-2026",
    });

    expect(config.providers.depop).toMatchObject({
      enabled: true,
      scrapingAllowed: true,
      authorizationReference: "depop-approval-2026",
      baseUrl: "https://webapi.depop.com",
      maxResultsPerSearch: 12,
    });
    expect(config.providers.yahooAuctionsJp).toMatchObject({
      enabled: true,
      scrapingAllowed: true,
      authorizationReference: "yahoo-jp-approval-2026",
      baseUrl: "https://auctions.yahoo.co.jp",
      maxResultsPerSearch: 13,
    });
    expect(config.providers.mercariJp).toMatchObject({
      enabled: true,
      scrapingAllowed: true,
      authorizationReference: "mercari-jp-approval-2026",
      baseUrl: "https://api.mercari.jp",
      maxResultsPerSearch: 14,
    });
    expect(config.providers.ebay).toMatchObject({
      enabled: true,
      configured: true,
      authorizationReference: "ebay-buy-approval-2026",
      locale: "en-US",
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
      GRAILED_MAX_CONCURRENCY: "3",
      GRAILED_MAX_RETRIES: "4",
      GRAILED_BASE_BACKOFF_MS: "125",
      GRAILED_MAX_RETRY_AFTER_MS: "9000",
      GRAILED_CIRCUIT_BREAKER_FAILURE_THRESHOLD: "7",
      GRAILED_CIRCUIT_BREAKER_COOLDOWN_MS: "45000",
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
      maxConcurrency: 3,
      maxRetries: 4,
      baseBackoffMs: 125,
      maxRetryAfterMs: 9000,
      circuitBreakerFailureThreshold: 7,
      circuitBreakerCooldownMs: 45000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });
  });

  it("bounds Grailed resilience settings from untrusted environment values", () => {
    const config = loadProviderRuntimeConfig({
      GRAILED_MAX_CONCURRENCY: "1000",
      GRAILED_MAX_RETRIES: "-2",
      GRAILED_BASE_BACKOFF_MS: "999999",
      GRAILED_MAX_RETRY_AFTER_MS: "999999",
      GRAILED_CIRCUIT_BREAKER_FAILURE_THRESHOLD: "0",
      GRAILED_CIRCUIT_BREAKER_COOLDOWN_MS: "10",
    });

    expect(config.providers.grailed).toMatchObject({
      maxConcurrency: 10,
      maxRetries: 0,
      baseBackoffMs: 10_000,
      maxRetryAfterMs: 300_000,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerCooldownMs: 1_000,
    });
  });

  it("bounds marketplace result caps to each reviewed adapter contract", () => {
    const config = loadProviderRuntimeConfig({
      DEPOP_MAX_RESULTS_PER_SEARCH: "500",
      GRAILED_MAX_RESULTS_PER_SEARCH: "500",
      MERCARI_JP_MAX_RESULTS_PER_SEARCH: "500",
      YAHOO_AUCTIONS_JP_MAX_RESULTS_PER_SEARCH: "500",
    });

    expect(config.providers.depop.maxResultsPerSearch).toBe(100);
    expect(config.providers.grailed.maxResultsPerSearch).toBe(100);
    expect(config.providers.mercariJp.maxResultsPerSearch).toBe(120);
    expect(config.providers.yahooAuctionsJp.maxResultsPerSearch).toBe(100);
  });
});
