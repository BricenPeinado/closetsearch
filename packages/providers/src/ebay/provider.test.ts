import { describe, expect, it, vi } from "vitest";
import type { ProviderFetch } from "../http/resilient-http.js";
import {
  ebayBrowseSearchFixture,
  ebayChangedSchemaFixture,
  ebayEmptySearchFixture,
  ebayMalformedSearchFixture,
} from "./fixtures.js";
import { createEbayProvider } from "./provider.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

const tokenResponse = {
  access_token: "fixture-application-token",
  expires_in: 7_200,
  token_type: "Application Access Token",
};

describe("createEbayProvider", () => {
  it("uses client-credentials OAuth and normalizes recorded Browse fixtures", async () => {
    const now = new Date("2026-07-24T12:00:00.000Z").valueOf();
    const fetchImpl = vi.fn(async (input: string, _init?: Parameters<ProviderFetch>[1]) => {
      if (input.endsWith("/identity/v1/oauth2/token")) {
        return jsonResponse(200, tokenResponse);
      }

      if (input.includes("/buy/browse/v1/item_summary/search")) {
        return jsonResponse(200, ebayBrowseSearchFixture);
      }

      throw new Error(`Unexpected fixture URL: ${input}`);
    });
    const provider = createEbayProvider({
      affiliateCampaignId: "fixture-campaign",
      affiliateReferenceId: "closetsearch-test",
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
      fetchImpl,
      locale: "ja-JP",
      maxRetries: 0,
      minRequestIntervalMs: 0,
      nowImpl: () => now,
    });
    const response = await provider.search({
      query: {
        text: "kapital",
        price: { min: 50, max: 400, currency: "USD" },
        listingTypes: ["buy_now"],
        sort: "newest",
      },
      pagination: {
        page: 1,
        pageSize: 2,
      },
    });

    expect(response.status).toBe("success");

    if (response.status !== "success") {
      throw new Error("Expected recorded eBay Browse response to normalize.");
    }

    expect(response.listings).toHaveLength(2);
    expect(response.listings[0]).toMatchObject({
      id: "ebay:v1|145100000001|0",
      providerId: "ebay",
      providerListingId: "v1|145100000001|0",
      source: {
        id: "ebay",
        name: "eBay",
        dataOrigin: "official_api",
        isMock: false,
        marketplaceId: "EBAY_US",
      },
      sourceUrl: "https://www.ebay.com/itm/145100000001?campid=fixture-campaign",
      title: "Kapital patchwork denim jacket",
      brand: {
        id: "brand:kapital",
        slug: "kapital",
        name: "Kapital",
      },
      imageUrl: "https://i.ebayimg.com/images/g/fixture-1/s-l1600.jpg",
      price: {
        amount: 325,
        amountMinor: 32_500,
        currency: "USD",
        fractionDigits: 2,
      },
      pricing: {
        original: { amountMinor: 32_500, currency: "USD" },
        shipping: { amountMinor: 1_250, currency: "USD" },
        landed: { amountMinor: 33_750, currency: "USD" },
      },
      category: "Coats, Jackets & Vests",
      size: "L",
      condition: "excellent",
      listingType: "buy_now",
      lifecycle: {
        status: "active",
        listedAt: "2026-07-20T14:30:00.000Z",
        observedAt: "2026-07-24T12:00:00.000Z",
      },
      freshness: {
        status: "fresh",
        observedAt: "2026-07-24T12:00:00.000Z",
      },
      seller: {
        username: "fixture-archivist",
        feedbackCount: 1_842,
        feedbackPercentage: 99.8,
        trustTier: "trusted",
      },
      shipping: {
        cost: { amountMinor: 1_250, currency: "USD" },
        isFree: false,
        originCountry: "US",
      },
      attribution: {
        affiliate: true,
        displayText: "View on eBay",
        marketplaceName: "eBay",
        required: true,
      },
      analyticsEligibility: {
        eligible: true,
      },
      market: {
        status: "active",
        isExcludedFromAnalytics: false,
      },
    });
    expect(response.pagination).toEqual({
      page: 1,
      pageSize: 2,
      hasMore: true,
      nextPage: 2,
      totalCount: 3,
    });
    expect(response.metadata).toMatchObject({
      providerId: "ebay",
      dataOrigin: "official_api",
      freshness: "fresh",
      resultCount: 2,
    });
    expect(response.listings[1]).toMatchObject({
      listingType: "auction",
      price: { amountMinor: 8_000, currency: "USD" },
      auction: {
        currentBid: { amountMinor: 8_000, currency: "USD" },
        bidCount: 7,
        endsAt: "2026-08-02T10:00:00.000Z",
      },
      market: {
        status: "active",
      },
    });
    expect(response.listings[1]?.auction?.completedPrice).toBeUndefined();
    expect(response.listings[1]?.market?.askingPrice).toBeUndefined();
    expect(response.listings[1]?.market?.soldPrice).toBeUndefined();

    const tokenCall = fetchImpl.mock.calls[0];
    expect(tokenCall?.[0]).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    expect(tokenCall?.[1]).toMatchObject({
      method: "POST",
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
      headers: {
        authorization: `Basic ${btoa("fixture-client:fixture-secret")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    });

    const searchCall = fetchImpl.mock.calls[1];
    const searchUrl = new URL(String(searchCall?.[0]));
    expect(searchUrl.pathname).toBe("/buy/browse/v1/item_summary/search");
    expect(searchUrl.searchParams.get("q")).toBe("kapital");
    expect(searchUrl.searchParams.get("limit")).toBe("2");
    expect(searchUrl.searchParams.get("offset")).toBe("0");
    expect(searchUrl.searchParams.get("sort")).toBe("newlyListed");
    expect(searchUrl.searchParams.get("filter")).toBe(
      "price:[50..400],priceCurrency:USD,buyingOptions:{FIXED_PRICE}",
    );
    expect(searchCall?.[1]).toMatchObject({
      headers: {
        "accept-language": "ja-JP",
        authorization: "Bearer fixture-application-token",
        "x-ebay-c-marketplace-id": "EBAY_US",
        "x-ebay-c-enduserctx":
          "affiliateCampaignId=fixture-campaign,affiliateReferenceId=closetsearch-test",
      },
    });
  });

  it("reuses a cached application token without persisting credentials", async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input.endsWith("/identity/v1/oauth2/token")
        ? jsonResponse(200, tokenResponse)
        : jsonResponse(200, ebayBrowseSearchFixture),
    );
    const provider = createEbayProvider({
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
      fetchImpl,
      maxRetries: 0,
      minRequestIntervalMs: 0,
    });

    await provider.search({ query: { text: "kapital" } });
    await provider.search({ query: { text: "kapital" } });

    expect(
      fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/identity/v1/oauth2/token")),
    ).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("drops malformed item payloads and reports an explicit warning", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, tokenResponse))
      .mockResolvedValueOnce(jsonResponse(200, ebayMalformedSearchFixture));
    const provider = createEbayProvider({
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
      fetchImpl,
      maxRetries: 0,
    });
    const response = await provider.search({
      query: { text: "kapital" },
    });

    expect(response.status).toBe("success");

    if (response.status !== "success") {
      throw new Error("Expected malformed individual items to be isolated.");
    }

    expect(response.listings).toHaveLength(1);
    expect(response.warnings).toEqual([
      {
        code: "malformed_items_dropped",
        message: "Dropped 1 malformed or unavailable eBay item summaries.",
        severity: "warning",
      },
    ]);
  });

  it("accepts an explicit empty result but degrades safely on a changed root schema", async () => {
    const emptyFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, tokenResponse))
      .mockResolvedValueOnce(jsonResponse(200, ebayEmptySearchFixture));
    const emptyProvider = createEbayProvider({
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
      fetchImpl: emptyFetch,
      maxRetries: 0,
    });

    await expect(emptyProvider.search({ query: { text: "missing" } })).resolves.toMatchObject({
      status: "success",
      listings: [],
      pagination: { hasMore: false, totalCount: 0 },
    });

    const changedFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, tokenResponse))
      .mockResolvedValueOnce(jsonResponse(200, ebayChangedSchemaFixture));
    const changedProvider = createEbayProvider({
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
      fetchImpl: changedFetch,
      maxRetries: 0,
    });

    await expect(changedProvider.search({ query: { text: "kapital" } })).resolves.toMatchObject({
      status: "failure",
      failure: { code: "invalid_response", retryable: false },
    });
  });

  it("honors Retry-After and classifies exhausted rate limits as retryable", async () => {
    const slept: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, tokenResponse))
      .mockResolvedValueOnce(jsonResponse(429, { errors: [] }, { "retry-after": "1" }))
      .mockResolvedValueOnce(jsonResponse(429, { errors: [] }, { "retry-after": "1" }));
    const provider = createEbayProvider({
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
      fetchImpl,
      maxRetries: 1,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });

    await expect(provider.search({ query: { text: "kapital" } })).resolves.toEqual({
      providerId: "ebay",
      status: "failure",
      failure: {
        providerId: "ebay",
        code: "rate_limited",
        classification: "retryable",
        message: "Provider HTTP request failed with retryable status 429.",
        retryAfterMs: 1_000,
        retryable: true,
        statusCode: 429,
      },
    });
    expect(slept).toEqual([1_000]);
  });

  it("fails before network access for credentials and unsupported sold history", async () => {
    const fetchImpl = vi.fn();
    const missingCredentials = createEbayProvider({ fetchImpl });
    const configured = createEbayProvider({
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
      fetchImpl,
    });

    await expect(missingCredentials.search({ query: { text: "kapital" } })).resolves.toMatchObject({
      status: "failure",
      failure: { code: "missing_credentials", retryable: false },
    });
    await expect(
      configured.search({
        query: { text: "kapital", marketScope: "sold" },
      }),
    ).resolves.toMatchObject({
      status: "failure",
      failure: { code: "unsupported_capability", retryable: false },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-official API origins before credentials can leave the process", () => {
    const fetchImpl = vi.fn();

    expect(() =>
      createEbayProvider({
        apiBaseUrl: "http://internal.invalid",
        clientId: "fixture-client",
        clientSecret: "fixture-secret",
        fetchImpl,
      }),
    ).toThrow(/official absolute HTTPS origin/);
    expect(() =>
      createEbayProvider({
        clientId: "fixture-client",
        clientSecret: "fixture-secret",
        fetchImpl,
        identityBaseUrl: "https://attacker.invalid",
      }),
    ).toThrow(/official absolute HTTPS origin/);
    expect(() =>
      createEbayProvider({
        clientId: "fixture-client",
        clientSecret: "fixture-secret",
        fetchImpl,
        locale: "not a locale",
      }),
    ).toThrow(/valid language tag/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
