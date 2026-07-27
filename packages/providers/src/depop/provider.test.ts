import { describe, expect, it, vi } from "vitest";
import type { ProviderFetch } from "../http/resilient-http.js";
import {
  depopChangedSchemaFixture,
  depopEmptySearchFixture,
  depopPartialSearchFixture,
  depopSearchFixture,
} from "./fixtures.js";
import { createDepopProvider } from "./provider.js";

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function provider(fetchImpl: ProviderFetch, overrides = {}) {
  return createDepopProvider({
    authorizationReference: "depop-authorization-fixture",
    fetchImpl,
    maxRetries: 0,
    minRequestIntervalMs: 0,
    nowImpl: () => new Date("2026-07-26T12:00:00.000Z").valueOf(),
    runtimeMode: "authorized-live",
    scrapingAllowed: true,
    ...overrides,
  });
}

describe("createDepopProvider", () => {
  it("maps filters, continuation, and a recorded response into normalized listings", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, depopSearchFixture));
    const result = await provider(fetchImpl).search({
      query: {
        text: "kapital jacket",
        brandSlugs: ["kapital"],
        categories: ["outerwear"],
        sizes: ["L"],
        conditions: ["excellent"],
        marketScope: "active",
        price: { min: 100, max: 300, currency: "USD" },
        sort: "recommended",
      },
      pagination: { cursor: "cursor-1", pageSize: 24 },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("Expected success.");
    expect(result.listings[0]).toMatchObject({
      id: "depop:depop-1001",
      providerId: "depop",
      description: "Indigo patchwork jacket in excellent condition.",
      pricing: {
        original: { amountMinor: 24_500, currency: "USD" },
        shipping: { amountMinor: 1_200, currency: "USD" },
      },
      market: { status: "active", askingPrice: { amountMinor: 24_500 } },
      seller: { username: "archivecloset" },
      lifecycle: { status: "active" },
    });
    expect(result.listings[1]?.market).toMatchObject({
      status: "sold",
      soldPrice: { amountMinor: 9_000 },
    });
    expect(result.pagination).toMatchObject({
      nextCursor: "depop-next-2",
      hasMore: true,
      totalCount: 3,
    });

    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.origin).toBe("https://webapi.depop.com");
    expect(url.searchParams.get("brands")).toBe("kapital");
    expect(url.searchParams.get("conditions")).toBe("excellent");
    expect(url.searchParams.get("cursor")).toBe("cursor-1");
    expect(url.searchParams.get("sort")).toBe("recommended");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("handles valid empty and partial pages without hiding malformed rows", async () => {
    const empty = await provider(
      vi.fn().mockResolvedValue(response(200, depopEmptySearchFixture)),
    ).search({
      query: { text: "nothing" },
    });
    expect(empty).toMatchObject({
      status: "success",
      listings: [],
      pagination: { hasMore: false },
    });

    const partial = await provider(
      vi.fn().mockResolvedValue(response(200, depopPartialSearchFixture)),
    ).search({ query: { text: "" } });
    expect(partial).toMatchObject({
      status: "success",
      listings: [expect.objectContaining({ providerListingId: "depop-1001" })],
      warnings: [expect.objectContaining({ code: "malformed_items_dropped" })],
    });
  });

  it("fails visibly on malformed JSON and changed response schemas", async () => {
    await expect(
      provider(vi.fn().mockResolvedValue(response(200, "{not-json"))).search({
        query: { text: "kapital" },
      }),
    ).resolves.toMatchObject({ status: "failure", failure: { code: "invalid_response" } });
    await expect(
      provider(vi.fn().mockResolvedValue(response(200, depopChangedSchemaFixture))).search({
        query: { text: "kapital" },
      }),
    ).resolves.toMatchObject({ status: "failure", failure: { code: "invalid_response" } });
  });

  it("honors Retry-After and retries throttled searches", async () => {
    const slept: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(429, {}, { "retry-after": "2" }))
      .mockResolvedValueOnce(response(200, depopEmptySearchFixture));
    const result = await provider(fetchImpl, {
      maxRetries: 1,
      sleepImpl: async (ms: number) => {
        slept.push(ms);
      },
    }).search({ query: { text: "" } });
    expect(result.status).toBe("success");
    expect(slept).toEqual([2_000]);
  });

  it("enforces the configured result cap in fixture and live modes", async () => {
    const fixtureResult = await createDepopProvider({
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

    const fetchImpl = vi.fn().mockResolvedValue(response(200, depopSearchFixture));
    const liveResult = await provider(fetchImpl, { maxResultsPerSearch: 1 }).search({
      query: { text: "" },
      pagination: { pageSize: 99 },
    });
    expect(liveResult).toMatchObject({
      status: "success",
      listings: [expect.any(Object)],
      pagination: { pageSize: 1 },
    });
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams.get("limit")).toBe("1");
  });

  it("fails closed on missing authorization and rejects unreviewed hosts", async () => {
    const fetchImpl = vi.fn();
    await expect(
      createDepopProvider({
        fetchImpl,
        runtimeMode: "authorized-live",
        scrapingAllowed: true,
      }).search({ query: { text: "" } }),
    ).resolves.toMatchObject({
      status: "failure",
      failure: { code: "authorization_required" },
    });
    expect(() =>
      createDepopProvider({
        authorizationReference: "fixture",
        baseUrl: "https://attacker.invalid",
        fetchImpl,
        runtimeMode: "authorized-live",
        scrapingAllowed: true,
      }),
    ).toThrow(/reviewed HTTPS API origin/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
