import { describe, expect, it, vi } from "vitest";
import {
  grailedAlgoliaActiveResponseFixture,
  grailedAlgoliaSoldResponseFixture,
  grailedCredentialBundleFixture,
  grailedHomepageScriptHtmlFixture,
  grailedNoCredentialHtmlFixture,
  grailedPublicConfigHtmlFixture,
} from "./fixtures";
import { createGrailedProvider } from "./provider";

function createTextResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

function createJsonResponse(status: number, body: unknown) {
  return createTextResponse(status, JSON.stringify(body));
}

describe("createGrailedProvider", () => {
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
          "Grailed scraping is not allowed until GRAILED_SCRAPING_ALLOWED=true is set with documented written permission.",
        retryable: false,
      },
    });
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
      .mockResolvedValueOnce(
        createJsonResponse(200, grailedAlgoliaActiveResponseFixture),
      );
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
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
      "https://grailed-app-123-dsn.algolia.net/1/indexes/Listing_production/query",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-algolia-api-key": "grailed-key-123",
          "x-algolia-application-id": "grailed-app-123",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://grailed-app-123-dsn.algolia.net/1/indexes/Listing_production/query",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-algolia-api-key": "grailed-key-123",
          "x-algolia-application-id": "grailed-app-123",
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
      .mockResolvedValueOnce(
        createJsonResponse(200, grailedAlgoliaSoldResponseFixture),
      );
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
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
      "https://grailed-app-123-dsn.algolia.net/1/indexes/Listing_sold_production/query",
      expect.objectContaining({ method: "POST" }),
    );
    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("Expected sold-market response to succeed.");
    }

    expect(response.listings[0]).toMatchObject({
      market: {
        status: "sold",
      },
      price: {
        amount: 295,
        currency: "USD",
      },
    });
  });

  it("refreshes credentials once after a simulated Algolia 401 and retries successfully", async () => {
    const refreshedPublicConfigHtmlFixture = grailedPublicConfigHtmlFixture.replace(
      "grailed-key-123",
      "grailed-key-456",
    ).replace("grailed-app-123", "grailed-app-456");
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
      .mockResolvedValueOnce(
        createJsonResponse(200, grailedAlgoliaActiveResponseFixture),
      );
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
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
      "https://grailed-app-456-dsn.algolia.net/1/indexes/Listing_production/query",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-algolia-api-key": "grailed-key-456",
          "x-algolia-application-id": "grailed-app-456",
        }),
      }),
    );
    expect(response.status).toBe("success");
  });

  it("returns an empty success response when the Algolia index has no results", async () => {
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
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
        const body = input.includes("grailed-app-456")
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

  it("returns recoverable failures for rate limits and timeouts", async () => {
    const rateLimitedProvider = createGrailedProvider({
      runtimeMode: "authorized-live",
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
        .mockResolvedValueOnce(createJsonResponse(429, { message: "rate limited" })),
    });
    const timeoutError = new Error("Timed out");
    timeoutError.name = "AbortError";
    const timeoutProvider = createGrailedProvider({
      runtimeMode: "authorized-live",
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
        message: "Grailed returned a rate-limit response. Back off before retrying.",
        retryable: true,
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
        message: "Grailed scraping request timed out.",
        retryable: true,
      },
    });
  });
});
