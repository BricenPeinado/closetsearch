import { describe, expect, it, vi } from "vitest";
import {
  grailedAlgoliaActiveResponseFixture,
  grailedAlgoliaSoldResponseFixture,
  grailedPublicConfigHtmlFixture,
} from "./fixtures";
import { createGrailedProvider } from "./provider";

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

  it("extracts live credentials and queries the active Algolia marketplace index", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => grailedPublicConfigHtmlFixture,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(grailedAlgoliaActiveResponseFixture),
      });
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
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => grailedPublicConfigHtmlFixture,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(grailedAlgoliaSoldResponseFixture),
      });
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
      2,
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
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => grailedPublicConfigHtmlFixture,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: "expired key" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => refreshedPublicConfigHtmlFixture,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(grailedAlgoliaActiveResponseFixture),
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

    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
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
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => grailedPublicConfigHtmlFixture,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              hits: [],
              hitsPerPage: 100,
              nbHits: 0,
              nbPages: 0,
              page: 0,
            }),
        }),
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

  it("returns recoverable failures for rate limits and timeouts", async () => {
    const rateLimitedProvider = createGrailedProvider({
      runtimeMode: "authorized-live",
      scrapingAllowed: true,
      minRequestIntervalMs: 0,
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => grailedPublicConfigHtmlFixture,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ message: "rate limited" }),
        }),
    });
    const timeoutError = new Error("Timed out");
    timeoutError.name = "AbortError";
    const timeoutProvider = createGrailedProvider({
      runtimeMode: "authorized-live",
      scrapingAllowed: true,
      minRequestIntervalMs: 0,
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => grailedPublicConfigHtmlFixture,
        })
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
