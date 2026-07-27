import { describe, expect, it, vi } from "vitest";
import {
  grailedAlgoliaActiveResponseFixture,
  grailedAlgoliaSoldResponseFixture,
  grailedCredentialBundleFixture,
  grailedHomepageScriptHtmlFixture,
  grailedNoCredentialHtmlFixture,
  grailedPublicConfigHtmlFixture,
} from "./fixtures";
import type { ProviderHttpMetric } from "../http/resilient-http";
import { createGrailedProvider } from "./provider";

function createTextResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    text: async () => body,
  };
}

function createJsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return createTextResponse(status, JSON.stringify(body), headers);
}

describe("createGrailedProvider", () => {
  it("rejects non-canonical authorized-live origins before networking", () => {
    const fetchImpl = vi.fn();

    expect(() =>
      createGrailedProvider({
        authorizationReference: "fixture-written-authorization",
        baseUrl: "http://127.0.0.1:4444/internal",
        fetchImpl,
        runtimeMode: "authorized-live",
        scrapingAllowed: true,
      }),
    ).toThrow(/canonical HTTPS marketplace origin/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses local fixtures by default and does not make live network calls", async () => {
    const fetchImpl = vi.fn();
    const provider = createGrailedProvider({ fetchImpl });
    const response = await provider.search({
      query: { text: "kapital", sort: "newest" },
      pagination: { page: 1, pageSize: 24 },
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("Expected Grailed fixture mode to return a success response.");
    }

    expect(response.listings.length).toBeGreaterThanOrEqual(1);
    expect(response.listings[0]).toMatchObject({
      providerId: "grailed",
      title: "Kapital ring coat",
      brand: { slug: "kapital" },
    });
    expect(response.pagination).toMatchObject({
      page: 1,
      pageSize: 24,
      hasMore: false,
      totalCount: 1,
    });
  });

  it("does not scrape unless authorization is explicitly enabled", async () => {
    const fetchImpl = vi.fn();
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      fetchImpl,
      scrapingAllowed: false,
    });
    const response = await provider.search({
      query: { text: "kapital" },
      pagination: { page: 1, pageSize: 24 },
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(response).toEqual({
      providerId: "grailed",
      status: "failure",
      failure: {
        providerId: "grailed",
        code: "authorization_required",
        message:
          "Grailed live access requires both GRAILED_SCRAPING_ALLOWED=true and a retained GRAILED_AUTHORIZATION_REFERENCE.",
        retryable: false,
      },
    });
  });

  it("does not treat a boolean authorization flag as retained written permission", async () => {
    const fetchImpl = vi.fn();
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      fetchImpl,
      scrapingAllowed: true,
    });

    await expect(provider.search({ query: { text: "kapital" } })).resolves.toMatchObject({
      status: "failure",
      failure: {
        code: "authorization_required",
        retryable: false,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("extracts live credentials, validates them, and queries the active Algolia marketplace index", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, grailedAlgoliaActiveResponseFixture));
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      fetchImpl,
      scrapingAllowed: true,
      minRequestIntervalMs: 0,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });
    const response = await provider.search({
      query: {
        text: "",
      },
      pagination: {
        page: 1,
        pageSize: 24,
      },
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://www.grailed.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "text/html,application/xhtml+xml",
          "user-agent": "ClosetSearchBot/0.1 contact:team@example.com",
          from: "team@example.com",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://GRAILED123-dsn.algolia.net/1/indexes/Listing_production/query",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-algolia-api-key": "grailed-key-123",
          "x-algolia-application-id": "GRAILED123",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://GRAILED123-dsn.algolia.net/1/indexes/Listing_production/query",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-algolia-api-key": "grailed-key-123",
          "x-algolia-application-id": "GRAILED123",
        }),
      }),
    );
    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("Expected authorized-live response to succeed.");
    }

    expect(response.listings).toHaveLength(2);
    expect(response.listings[0]).toMatchObject({
      providerId: "grailed",
      title: "Kapital ring coat",
      brand: { slug: "kapital" },
      seller: {
        username: "trusted-seller",
        trustTier: "trusted",
      },
      market: {
        status: "active",
        priceDropsCount: 2,
        isExcludedFromAnalytics: false,
      },
    });
    expect(response.listings[1]).toMatchObject({
      seller: {
        trustTier: "unverified",
      },
      market: {
        isExcludedFromAnalytics: true,
      },
    });
    expect(response.pagination).toMatchObject({
      page: 1,
      pageSize: 100,
      hasMore: false,
      totalCount: 2,
    });
  });

  it("drops malformed live hits while preserving valid results and a warning", async () => {
    const malformedResponse = {
      ...grailedAlgoliaActiveResponseFixture,
      hits: [
        {},
        {
          objectID: "grailed-hostile-url",
          title: "Hostile URL",
          url: "https://attacker.invalid/listing",
          price_in_cents: 12_500,
          currency: "USD",
        },
        grailedAlgoliaActiveResponseFixture.hits[0],
      ],
      nbHits: 3,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, malformedResponse));
    const provider = createGrailedProvider({
      authorizationReference: "fixture-written-authorization",
      fetchImpl,
      minRequestIntervalMs: 0,
      runtimeMode: "authorized-live",
      scrapingAllowed: true,
    });
    const response = await provider.search({
      query: { text: "" },
      pagination: { page: 1, pageSize: 24 },
    });

    expect(response).toMatchObject({
      listings: [
        expect.objectContaining({
          providerListingId: "grailed-1001-kapital-ring-coat",
        }),
      ],
      status: "success",
      warnings: [
        {
          code: "malformed_items_dropped",
          message: "Dropped 2 malformed Grailed listing records.",
          severity: "warning",
        },
      ],
    });
  });

  it("degrades safely when the live search root schema changes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, { results: [] }));
    const provider = createGrailedProvider({
      authorizationReference: "fixture-written-authorization",
      fetchImpl,
      maxRetries: 0,
      minRequestIntervalMs: 0,
      runtimeMode: "authorized-live",
      scrapingAllowed: true,
    });

    await expect(provider.search({ query: { text: "kapital" } })).resolves.toMatchObject({
      status: "failure",
      failure: {
        code: "invalid_response",
        retryable: false,
      },
    });
  });

  it("switches to the sold Algolia index when the market scope requests historical comps", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, grailedAlgoliaSoldResponseFixture));
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      fetchImpl,
      scrapingAllowed: true,
      minRequestIntervalMs: 0,
    });
    const response = await provider.search({
      query: {
        text: "kapital",
        marketScope: "sold",
      },
      pagination: {
        page: 1,
        pageSize: 24,
      },
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://GRAILED123-dsn.algolia.net/1/indexes/Listing_sold_production/query",
      expect.objectContaining({ method: "POST" }),
    );
    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("Expected sold-market response to succeed.");
    }

    expect(response.listings[0]).toMatchObject({
      market: {
        status: "sold",
        soldPrice: {
          amount: 295,
          currency: "USD",
        },
      },
      price: {
        amount: 295,
        currency: "USD",
      },
    });
    expect(response.listings[0]?.market?.askingPrice).toBeUndefined();
  });

  it("refreshes credentials once after a simulated Algolia 401 and retries successfully", async () => {
    const refreshedPublicConfigHtmlFixture = grailedPublicConfigHtmlFixture
      .replace("grailed-key-123", "grailed-key-456")
      .replace("GRAILED123", "GRAILED456");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(401, { message: "expired key" }))
      .mockResolvedValueOnce(createTextResponse(200, refreshedPublicConfigHtmlFixture))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, grailedAlgoliaActiveResponseFixture));
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      fetchImpl,
      scrapingAllowed: true,
      minRequestIntervalMs: 0,
    });
    const response = await provider.search({
      query: { text: "kapital" },
      pagination: { page: 1, pageSize: 24 },
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      "https://GRAILED456-dsn.algolia.net/1/indexes/Listing_production/query",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-algolia-api-key": "grailed-key-456",
          "x-algolia-application-id": "GRAILED456",
        }),
      }),
    );
    expect(response.status).toBe("success");
  });

  it("returns an empty success response when the Algolia index has no results", async () => {
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      scrapingAllowed: true,
      minRequestIntervalMs: 0,
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
        .mockResolvedValueOnce(
          createJsonResponse(200, {
            hits: [],
            hitsPerPage: 1,
            nbHits: 0,
            nbPages: 0,
            page: 0,
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse(200, {
            hits: [],
            hitsPerPage: 100,
            nbHits: 0,
            nbPages: 0,
            page: 0,
          }),
        ),
    });
    const response = await provider.search({
      query: { text: "nonexistent archive piece" },
      pagination: { page: 1, pageSize: 24 },
    });

    expect(response).toMatchObject({
      providerId: "grailed",
      status: "success",
      listings: [],
      pagination: {
        page: 1,
        pageSize: 100,
        hasMore: false,
        totalCount: 0,
      },
    });
  });

  it("returns listings when credentials are discovered from script bundles", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === "https://www.grailed.com") {
        return createTextResponse(200, grailedHomepageScriptHtmlFixture);
      }

      if (input === "https://www.grailed.com/assets/runtime.js") {
        return createTextResponse(200, "window.__runtime=true;");
      }

      if (input === "https://www.grailed.com/assets/listings.js") {
        return createTextResponse(200, grailedCredentialBundleFixture);
      }

      if (input.includes("algolia.net/1/indexes/Listing_production/query")) {
        const body = input.includes("GRAILED456")
          ? grailedAlgoliaActiveResponseFixture
          : {
              hits: [],
              hitsPerPage: 1,
              nbHits: 0,
              nbPages: 0,
              page: 0,
            };

        return createJsonResponse(200, body);
      }

      throw new Error(`Unexpected URL: ${input}`);
    });
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      fetchImpl,
      scrapingAllowed: true,
      minRequestIntervalMs: 0,
    });
    const response = await provider.search({
      query: { text: "kapital", sort: "newest" },
      pagination: { page: 1, pageSize: 24 },
    });

    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("Expected script-discovered credentials to succeed.");
    }

    expect(response.listings[0]).toMatchObject({
      providerId: "grailed",
      title: "Kapital ring coat",
      brand: { slug: "kapital" },
      price: { amount: 325, currency: "USD" },
      imageUrl: "https://media.example.com/grailed-1001.jpg",
      sourceUrl: "https://www.grailed.com/listings/grailed-1001-kapital-ring-coat",
    });
  });

  it("returns a useful failure message when discovery stages are exhausted", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === "https://www.grailed.com") {
        return createTextResponse(200, grailedNoCredentialHtmlFixture);
      }

      if (input === "https://www.grailed.com/assets/runtime.js") {
        return createTextResponse(200, "window.__runtime=true;");
      }

      if (input === "https://www.grailed.com/shop?query=kapital") {
        return createTextResponse(200, grailedPublicConfigHtmlFixture);
      }

      if (input.includes("algolia.net/1/indexes/Listing_production/query")) {
        return createJsonResponse(401, { message: "invalid credentials" });
      }

      throw new Error(`Unexpected URL: ${input}`);
    });
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      fetchImpl,
      scrapingAllowed: true,
      minRequestIntervalMs: 0,
    });
    const response = await provider.search({
      query: { text: "kapital" },
      pagination: { page: 1, pageSize: 24 },
    });

    expect(response).toEqual({
      providerId: "grailed",
      status: "failure",
      failure: {
        providerId: "grailed",
        code: "missing_credentials",
        message:
          "Grailed Algolia credential discovery failed: cache miss; homepage-inline: no inline config found; homepage-script: no usable script bundle credentials found; search-inline: validation failed; search-script: no usable script bundle credentials found.",
        retryable: false,
      },
    });
  });

  it("retries transient failures with bounded exponential backoff across searches", async () => {
    const slept: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, grailedAlgoliaActiveResponseFixture))
      .mockResolvedValueOnce(createJsonResponse(503, { message: "unavailable" }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, grailedAlgoliaActiveResponseFixture));
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      baseBackoffMs: 125,
      fetchImpl,
      maxRetries: 1,
      minRequestIntervalMs: 0,
      randomImpl: () => 0.5,
      scrapingAllowed: true,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });

    await expect(provider.search({ query: { text: "kapital" } })).resolves.toMatchObject({
      status: "success",
    });
    await expect(provider.search({ query: { text: "kapital" } })).resolves.toMatchObject({
      status: "success",
    });

    expect(slept).toEqual([125]);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("honors bounded Retry-After and emits secret-free HTTP metrics", async () => {
    const slept: number[] = [];
    const metrics: ProviderHttpMetric[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, grailedAlgoliaActiveResponseFixture))
      .mockResolvedValueOnce(
        createJsonResponse(
          429,
          { message: "rate limited" },
          {
            "retry-after": "9",
          },
        ),
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, grailedAlgoliaActiveResponseFixture));
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "retained-secret-free-reference",
      fetchImpl,
      maxRetries: 1,
      maxRetryAfterMs: 2_000,
      minRequestIntervalMs: 0,
      onHttpMetric: (metric) => metrics.push(metric),
      scrapingAllowed: true,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });

    await provider.search({ query: { text: "kapital" } });
    await expect(provider.search({ query: { text: "kapital" } })).resolves.toMatchObject({
      status: "success",
    });

    expect(slept).toEqual([2_000]);
    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attempts: 2,
          operation: "algolia_query",
          outcome: "success",
        }),
      ]),
    );
    expect(JSON.stringify(metrics)).not.toContain("grailed-key-123");
    expect(JSON.stringify(metrics)).not.toContain("retained-secret-free-reference");
  });

  it("bounds concurrent authorized-live requests with one persistent client", async () => {
    let callCount = 0;
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const releases: Array<() => void> = [];
    const fetchImpl = vi.fn(async () => {
      callCount += 1;

      if (callCount === 1) {
        return createTextResponse(200, grailedPublicConfigHtmlFixture);
      }

      if (callCount <= 3) {
        return createJsonResponse(
          200,
          callCount === 2
            ? {
                hits: [],
                hitsPerPage: 1,
                nbHits: 0,
                nbPages: 0,
                page: 0,
              }
            : grailedAlgoliaActiveResponseFixture,
        );
      }

      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise<void>((resolve) => releases.push(resolve));
      activeRequests -= 1;
      return createJsonResponse(200, grailedAlgoliaActiveResponseFixture);
    });
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      fetchImpl,
      maxConcurrency: 1,
      maxRetries: 0,
      minRequestIntervalMs: 0,
      scrapingAllowed: true,
    });

    await provider.search({ query: { text: "initial" } });
    const firstSearch = provider.search({ query: { text: "first" } });
    const secondSearch = provider.search({ query: { text: "second" } });

    for (let expectedCallCount = 4; expectedCallCount <= 7; expectedCallCount += 1) {
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(expectedCallCount));
      releases.shift()?.();
    }

    await expect(Promise.all([firstSearch, secondSearch])).resolves.toEqual([
      expect.objectContaining({ status: "success" }),
      expect.objectContaining({ status: "success" }),
    ]);
    expect(maximumActiveRequests).toBe(1);
  });

  it("keeps circuit-breaker state across searches and rejects without networking while open", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, grailedAlgoliaActiveResponseFixture))
      .mockResolvedValueOnce(createJsonResponse(503, { message: "unavailable" }))
      .mockResolvedValueOnce(createJsonResponse(503, { message: "unavailable" }));
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      circuitBreakerCooldownMs: 30_000,
      circuitBreakerFailureThreshold: 2,
      fetchImpl,
      maxRetries: 0,
      minRequestIntervalMs: 0,
      nowImpl: () => 0,
      scrapingAllowed: true,
    });

    await expect(provider.search({ query: { text: "initial" } })).resolves.toMatchObject({
      status: "success",
    });
    await expect(provider.search({ query: { text: "failure-one" } })).resolves.toMatchObject({
      status: "failure",
      failure: { code: "unavailable", retryable: true, statusCode: 503 },
    });
    await expect(provider.search({ query: { text: "failure-two" } })).resolves.toMatchObject({
      status: "failure",
      failure: { code: "unavailable", retryable: true, statusCode: 503 },
    });
    await expect(provider.search({ query: { text: "circuit-open" } })).resolves.toMatchObject({
      status: "failure",
      failure: { code: "circuit_open", retryable: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("returns recoverable failures for rate limits and timeouts", async () => {
    const rateLimitedProvider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      scrapingAllowed: true,
      minRequestIntervalMs: 0,
      maxRetries: 0,
      randomImpl: () => 0.5,
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
        .mockResolvedValueOnce(
          createJsonResponse(200, {
            hits: [],
            hitsPerPage: 1,
            nbHits: 0,
            nbPages: 0,
            page: 0,
          }),
        )
        .mockResolvedValueOnce(createJsonResponse(429, { message: "rate limited" })),
    });
    const timeoutError = new Error("Timed out");
    timeoutError.name = "AbortError";
    const timeoutProvider = createGrailedProvider({
      runtimeMode: "authorized-live",
      authorizationReference: "fixture-written-authorization",
      scrapingAllowed: true,
      minRequestIntervalMs: 0,
      maxRetries: 0,
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce(createTextResponse(200, grailedPublicConfigHtmlFixture))
        .mockResolvedValueOnce(
          createJsonResponse(200, {
            hits: [],
            hitsPerPage: 1,
            nbHits: 0,
            nbPages: 0,
            page: 0,
          }),
        )
        .mockRejectedValueOnce(timeoutError),
    });

    await expect(
      rateLimitedProvider.search({
        query: { text: "kapital" },
        pagination: { page: 1, pageSize: 24 },
      }),
    ).resolves.toEqual({
      providerId: "grailed",
      status: "failure",
      failure: {
        providerId: "grailed",
        code: "rate_limited",
        message: "Provider HTTP request failed with retryable status 429.",
        retryable: true,
        retryAfterMs: 250,
        statusCode: 429,
      },
    });

    await expect(
      timeoutProvider.search({
        query: { text: "kapital" },
        pagination: { page: 1, pageSize: 24 },
      }),
    ).resolves.toEqual({
      providerId: "grailed",
      status: "failure",
      failure: {
        providerId: "grailed",
        code: "timeout",
        message: "Provider HTTP request timed out.",
        retryable: true,
      },
    });
  });
});
