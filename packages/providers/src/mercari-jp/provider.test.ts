import { describe, expect, it, vi } from "vitest";
import type { ProviderFetch } from "../http/resilient-http.js";
import {
  mercariJpChangedSchemaFixture,
  mercariJpEmptySearchFixture,
  mercariJpPartialSearchFixture,
  mercariJpSearchFixture,
} from "./fixtures.js";
import { createMercariJpProvider } from "./provider.js";

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
  return createMercariJpProvider({
    authorizationReference: "mercari-jp-authorization-fixture",
    fetchImpl,
    maxRetries: 0,
    minRequestIntervalMs: 0,
    nowImpl: () => new Date("2026-07-26T12:00:00.000Z").valueOf(),
    runtimeMode: "authorized-live",
    scrapingAllowed: true,
    ...overrides,
  });
}

describe("createMercariJpProvider", () => {
  it("keeps Mercari Japan identity, JPY, Japanese text, filters, and continuation distinct", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, mercariJpSearchFixture));
    const result = await provider(fetchImpl).search({
      query: {
        text: "ジャケット",
        brandSlugs: ["yohji-yamamoto"],
        categories: ["ジャケット/アウター"],
        sizes: ["3"],
        conditions: ["good"],
        marketScope: "active",
        price: { min: 20_000, max: 50_000, currency: "JPY" },
        sort: "recommended",
      },
      pagination: { cursor: "mercari-cursor-1", pageSize: 24 },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("Expected success.");
    expect(result.listings[0]).toMatchObject({
      id: "mercari-jp:m12345678901",
      providerId: "mercari-jp",
      source: {
        id: "mercari-jp",
        name: "Mercari Japan",
        marketplaceId: "MERCARI_JP",
      },
      originalTitle: "ヨウジヤマモト ウール ギャバジン ジャケット",
      translatedTitle: "Yohji Yamamoto wool gabardine jacket",
      originalLanguage: "ja",
      brand: { slug: "yohji-yamamoto" },
      price: { amountMinor: 38_000, currency: "JPY", fractionDigits: 0 },
      market: { status: "active", askingPrice: { amountMinor: 38_000 } },
      shipping: { payer: "seller" },
      marketplaceLimitations: {
        closetSearchRole: "discovery_only",
        internationalShipping: "proxy_only",
      },
    });
    expect(result.listings[1]).toMatchObject({
      market: { status: "sold", soldPrice: { amountMinor: 19_000 } },
    });
    expect(result.pagination).toMatchObject({
      hasMore: true,
      nextCursor: "mercari-next-2",
      totalCount: 3,
    });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.mercari.jp/v2/entities:search");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "manual",
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      pageToken: "mercari-cursor-1",
      sort: "SORT_RECOMMENDED",
      filters: {
        status: "active",
        minPrice: 20_000,
        maxPrice: 50_000,
      },
    });
    expect(JSON.stringify(body)).toContain("ヨウジヤマモト");
  });

  it("handles empty and partial responses without conflating hostile URLs", async () => {
    await expect(
      provider(vi.fn().mockResolvedValue(response(200, mercariJpEmptySearchFixture))).search({
        query: { text: "なし" },
      }),
    ).resolves.toMatchObject({ status: "success", listings: [] });
    await expect(
      provider(vi.fn().mockResolvedValue(response(200, mercariJpPartialSearchFixture))).search({
        query: { text: "" },
      }),
    ).resolves.toMatchObject({
      status: "success",
      listings: [expect.objectContaining({ providerListingId: "m12345678901" })],
      warnings: [expect.objectContaining({ code: "malformed_items_dropped" })],
    });
  });

  it("detects malformed JSON and response-shape changes", async () => {
    await expect(
      provider(vi.fn().mockResolvedValue(response(200, "not-json"))).search({
        query: { text: "" },
      }),
    ).resolves.toMatchObject({ status: "failure", failure: { code: "invalid_response" } });
    await expect(
      provider(vi.fn().mockResolvedValue(response(200, mercariJpChangedSchemaFixture))).search({
        query: { text: "" },
      }),
    ).resolves.toMatchObject({ status: "failure", failure: { code: "invalid_response" } });
  });

  it("retries throttled searches using Retry-After", async () => {
    const slept: number[] = [];
    const result = await provider(
      vi
        .fn()
        .mockResolvedValueOnce(response(429, {}, { "retry-after": "1.5" }))
        .mockResolvedValueOnce(response(200, mercariJpEmptySearchFixture)),
      {
        maxRetries: 1,
        sleepImpl: async (ms: number) => {
          slept.push(ms);
        },
      },
    ).search({ query: { text: "" } });
    expect(result.status).toBe("success");
    expect(slept).toEqual([1_500]);
  });

  it("enforces the configured result cap in fixture and live modes", async () => {
    const fixtureResult = await createMercariJpProvider({
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

    const fetchImpl = vi.fn().mockResolvedValue(response(200, mercariJpSearchFixture));
    const liveResult = await provider(fetchImpl, { maxResultsPerSearch: 1 }).search({
      query: { text: "" },
      pagination: { pageSize: 99 },
    });
    expect(liveResult).toMatchObject({
      status: "success",
      listings: [expect.any(Object)],
      pagination: { pageSize: 1 },
    });
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(requestBody.pageSize).toBe(1);
  });

  it("requires authorization and rejects Mercari US or arbitrary request origins", async () => {
    const fetchImpl = vi.fn();
    await expect(
      createMercariJpProvider({
        fetchImpl,
        runtimeMode: "authorized-live",
        scrapingAllowed: true,
      }).search({ query: { text: "" } }),
    ).resolves.toMatchObject({
      status: "failure",
      failure: { code: "authorization_required" },
    });
    expect(() =>
      createMercariJpProvider({
        authorizationReference: "fixture",
        baseUrl: "https://www.mercari.com",
        fetchImpl,
        runtimeMode: "authorized-live",
        scrapingAllowed: true,
      }),
    ).toThrow(/reviewed HTTPS API origin/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
