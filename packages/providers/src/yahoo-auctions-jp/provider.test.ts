import { describe, expect, it, vi } from "vitest";
import type { ProviderFetch } from "../http/resilient-http.js";
import {
  yahooAuctionsJpChangedSchemaFixture,
  yahooAuctionsJpEmptySearchFixture,
  yahooAuctionsJpPartialSearchFixture,
  yahooAuctionsJpSearchFixture,
} from "./fixtures.js";
import { createYahooAuctionsJpProvider } from "./provider.js";

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function provider(fetchImpl: ProviderFetch, overrides = {}) {
  return createYahooAuctionsJpProvider({
    authorizationReference: "yahoo-jp-authorization-fixture",
    fetchImpl,
    maxRetries: 0,
    minRequestIntervalMs: 0,
    nowImpl: () => new Date("2026-07-26T12:00:00.000Z").valueOf(),
    runtimeMode: "authorized-live",
    scrapingAllowed: true,
    ...overrides,
  });
}

describe("createYahooAuctionsJpProvider", () => {
  it("preserves Japanese text and keeps live bids separate from completed sales", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, yahooAuctionsJpSearchFixture));
    const result = await provider(fetchImpl).search({
      query: {
        text: "ジャケット",
        brandSlugs: ["kapital"],
        categories: ["ジャケット"],
        sizes: ["3"],
        conditions: ["good"],
        listingTypes: ["auction"],
        marketScope: "active",
        price: { min: 10_000, max: 50_000, currency: "JPY" },
        sort: "ending_soon",
      },
      pagination: { page: 1, pageSize: 24 },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("Expected success.");
    expect(result.listings[0]).toMatchObject({
      id: "yahoo-auctions-jp:x123456789",
      originalTitle: "キャピタル BORO パッチワーク ジャケット",
      translatedTitle: "Kapital BORO patchwork jacket",
      originalLanguage: "ja",
      brand: { slug: "kapital" },
      price: { amountMinor: 28_000, currency: "JPY", fractionDigits: 0 },
      auction: {
        currentBid: { amountMinor: 28_000 },
        buyNowPrice: { amountMinor: 45_000 },
        completedPrice: undefined,
        bidCount: 7,
      },
      market: { status: "active", askingPrice: undefined, soldPrice: undefined },
      marketplaceLimitations: {
        closetSearchRole: "discovery_only",
        internationalShipping: "proxy_only",
        proxyPurchaseRequired: true,
      },
    });
    expect(result.listings[1]).toMatchObject({
      auction: {
        currentBid: { amountMinor: 8_000 },
        completedPrice: { amountMinor: 12_500 },
      },
      market: { status: "sold", soldPrice: { amountMinor: 12_500 } },
      price: { amountMinor: 12_500 },
    });

    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.origin).toBe("https://auctions.yahoo.co.jp");
    expect(url.searchParams.get("brand_aliases")).toContain("キャピタル");
    expect(url.searchParams.get("sort")).toBe("end");
    expect(url.searchParams.get("currency")).toBe("JPY");
  });

  it("supports empty and partial pages with explicit degradation", async () => {
    await expect(
      provider(vi.fn().mockResolvedValue(response(200, yahooAuctionsJpEmptySearchFixture))).search({
        query: { text: "なし" },
      }),
    ).resolves.toMatchObject({ status: "success", listings: [] });
    await expect(
      provider(
        vi.fn().mockResolvedValue(response(200, yahooAuctionsJpPartialSearchFixture)),
      ).search({
        query: { text: "" },
      }),
    ).resolves.toMatchObject({
      status: "success",
      listings: [expect.objectContaining({ providerListingId: "x123456789" })],
      warnings: [expect.objectContaining({ code: "malformed_items_dropped" })],
    });
  });

  it("detects malformed JSON and changed schemas", async () => {
    await expect(
      provider(vi.fn().mockResolvedValue(response(200, "not-json"))).search({
        query: { text: "" },
      }),
    ).resolves.toMatchObject({ status: "failure", failure: { code: "invalid_response" } });
    await expect(
      provider(
        vi.fn().mockResolvedValue(response(200, yahooAuctionsJpChangedSchemaFixture)),
      ).search({
        query: { text: "" },
      }),
    ).resolves.toMatchObject({ status: "failure", failure: { code: "invalid_response" } });
  });

  it("retries throttled requests using bounded Retry-After", async () => {
    const slept: number[] = [];
    const result = await provider(
      vi
        .fn()
        .mockResolvedValueOnce(response(429, {}, { "retry-after": "1" }))
        .mockResolvedValueOnce(response(200, yahooAuctionsJpEmptySearchFixture)),
      {
        maxRetries: 1,
        sleepImpl: async (ms: number) => {
          slept.push(ms);
        },
      },
    ).search({ query: { text: "" } });
    expect(result.status).toBe("success");
    expect(slept).toEqual([1_000]);
  });

  it("enforces the configured result cap in fixture and live modes", async () => {
    const fixtureResult = await createYahooAuctionsJpProvider({
      maxResultsPerSearch: 1,
    }).search({
      query: { text: "" },
      pagination: { pageSize: 99 },
    });
    expect(fixtureResult).toMatchObject({
      status: "success",
      listings: [expect.any(Object)],
      pagination: { pageSize: 1 },
    });

    const fetchImpl = vi.fn().mockResolvedValue(response(200, yahooAuctionsJpSearchFixture));
    const liveResult = await provider(fetchImpl, { maxResultsPerSearch: 1 }).search({
      query: { text: "" },
      pagination: { pageSize: 99 },
    });
    expect(liveResult).toMatchObject({
      status: "success",
      listings: [expect.any(Object)],
      pagination: { pageSize: 1 },
    });
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams.get("page_size")).toBe("1");
  });

  it("fails closed and rejects unexpected request origins before networking", async () => {
    const fetchImpl = vi.fn();
    await expect(
      createYahooAuctionsJpProvider({
        fetchImpl,
        runtimeMode: "authorized-live",
        scrapingAllowed: true,
      }).search({ query: { text: "" } }),
    ).resolves.toMatchObject({
      status: "failure",
      failure: { code: "authorization_required" },
    });
    expect(() =>
      createYahooAuctionsJpProvider({
        authorizationReference: "fixture",
        baseUrl: "http://127.0.0.1",
        fetchImpl,
        runtimeMode: "authorized-live",
        scrapingAllowed: true,
      }),
    ).toThrow(/reviewed HTTPS marketplace origin/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
