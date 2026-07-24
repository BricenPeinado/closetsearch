import type {
  Provider,
  ProviderSearchFailure,
  ProviderSearchResponse,
} from "@closetsearch/providers";
import type { Listing, SearchQuery } from "@closetsearch/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMetrics, resetMetrics } from "../metrics.js";
import { resetProviderSearchCache, runProviderSearch } from "./orchestrator.js";
import type { ProviderRuntime } from "./registry.js";
import { loadProviderRuntimeConfig } from "./runtime-config.js";

function createListing(id: string): Listing {
  return {
    id,
    providerId: "mock",
    providerListingId: id,
    source: {
      id: "mock",
      name: "Mock Closet",
    },
    sourceUrl: "https://example.com/" + id,
    title: "Listing " + id,
    brand: {
      id: "brand:test",
      slug: "test-brand",
      name: "Test Brand",
    },
    imageUrl: "https://example.com/image.jpg",
    price: {
      amount: 100,
      currency: "USD",
    },
    category: "jackets",
    size: "M",
    condition: "good",
    listingType: "buy_now",
    fetchedAt: "2026-06-13T12:00:00.000Z",
  };
}

function createRuntime(activeProviders: ProviderRuntime["activeProviders"]): ProviderRuntime {
  return {
    config: loadProviderRuntimeConfig({}),
    activeProviders,
    preflightFailures: [],
    statuses: [],
  };
}

describe("runProviderSearch", () => {
  beforeEach(() => {
    resetProviderSearchCache();
    resetMetrics();
  });

  it("captures provider failures without breaking the normalized response", async () => {
    const successProvider: Provider = {
      id: "mock",
      name: "Mock Closet",
      async search() {
        return {
          providerId: "mock",
          status: "success",
          listings: [createListing("mock:success-1")],
          pagination: {
            page: 1,
            pageSize: 24,
            hasMore: false,
            totalCount: 1,
          },
        };
      },
    };
    const failingProvider: Provider = {
      id: "throwing",
      name: "Throwing Provider",
      async search() {
        throw new Error("secret upstream URL and credential detail");
      },
    };

    const result = await runProviderSearch(
      { text: "jacket", pageSize: 24 },
      createRuntime([
        { mode: "mock", name: successProvider.name, provider: successProvider },
        { mode: "real", name: failingProvider.name, provider: failingProvider },
      ]),
    );

    expect(result.listings).toHaveLength(1);
    expect(result.pagination).toMatchObject({
      page: 1,
      pageSize: 24,
      hasMore: true,
    });
    expect(result.providers).toMatchObject([
      {
        providerId: "mock",
        providerName: "Mock Closet",
        status: "success",
        resultCount: 1,
      },
      {
        providerId: "throwing",
        providerName: "Throwing Provider",
        status: "failure",
        resultCount: 0,
      },
    ]);
    expect(result.failures).toEqual([
      expect.objectContaining({
        providerId: "throwing",
        code: "unavailable",
        message: "Throwing Provider could not complete the request.",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("secret upstream URL and credential detail");
    expect(renderMetrics()).toContain(
      'closetsearch_provider_requests_total{outcome="failure",provider="throwing"} 1',
    );
  });

  it("records provider rate-limit responses without exposing error details in labels", async () => {
    const provider: Provider = {
      id: "limited",
      name: "Rate Limited Provider",
      async search(): Promise<ProviderSearchResponse> {
        return {
          failure: {
            code: "rate_limited",
            message: "secret upstream detail",
            providerId: "limited",
            retryable: true,
          },
          providerId: "limited",
          status: "failure",
        };
      },
    };

    const result = await runProviderSearch(
      { text: "jacket", pageSize: 24 },
      createRuntime([{ mode: "real", name: provider.name, provider }]),
    );
    const metrics = renderMetrics();

    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "rate_limited",
        providerId: "limited",
      }),
    ]);
    expect(metrics).toContain('closetsearch_provider_rate_limits_total{provider="limited"} 1');
    expect(metrics).not.toContain("secret upstream detail");
  });

  it("strips provider-specific raw fields before results reach the API response layer", async () => {
    const rawListing = {
      ...createListing("mock:raw-1"),
      rawPayload: {
        marketplaceId: "abc123",
      },
    } as Listing & { rawPayload: { marketplaceId: string } };

    const provider: Provider = {
      id: "mock",
      name: "Mock Closet",
      async search(): Promise<ProviderSearchResponse> {
        return {
          providerId: "mock",
          status: "success",
          listings: [rawListing],
          pagination: {
            page: 1,
            pageSize: 24,
            hasMore: false,
            totalCount: 1,
          },
        };
      },
    };

    const result = await runProviderSearch(
      { text: "jacket", pageSize: 24 },
      createRuntime([{ mode: "mock", name: provider.name, provider }]),
    );

    expect(result.listings[0]).toEqual(createListing("mock:raw-1"));
    expect("rawPayload" in (result.listings[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it("returns a failure summary when a provider cannot support the requested query capability", async () => {
    const provider: Provider = {
      id: "limited",
      name: "Limited Provider",
      capabilities: {
        supportsPriceRange: false,
      },
      async search(): Promise<ProviderSearchFailure> {
        throw new Error("This provider should not be called for unsupported queries.");
      },
    };

    const result = await runProviderSearch(
      {
        text: "jacket",
        pageSize: 24,
        price: {
          min: 100,
          currency: "USD",
        },
      } satisfies SearchQuery,
      createRuntime([{ mode: "real", name: provider.name, provider }]),
    );

    expect(result.listings).toEqual([]);
    expect(result.providers).toEqual([
      {
        providerId: "limited",
        providerName: "Limited Provider",
        status: "failure",
        resultCount: 0,
      },
    ]);
    expect(result.failures).toEqual([
      expect.objectContaining({
        providerId: "limited",
        code: "unsupported_capability",
      }),
    ]);
  });

  it("dedupes repeated provider batches across cursor pages and reuses the cached provider page", async () => {
    let searchCalls = 0;
    const provider: Provider = {
      id: "cached",
      name: "Cached Provider",
      async search() {
        searchCalls += 1;

        return {
          providerId: "cached",
          status: "success",
          listings: [createListing("cached:1"), createListing("cached:2")],
          pagination: {
            page: 1,
            pageSize: 2,
            hasMore: false,
            totalCount: 2,
          },
        };
      },
    };
    const runtime = createRuntime([{ mode: "real", name: provider.name, provider }]);

    const firstPage = await runProviderSearch({ text: "jacket", pageSize: 1 }, runtime);
    const secondPage = await runProviderSearch(
      {
        text: "jacket",
        cursor: firstPage.pagination.nextCursor,
        pageSize: 1,
      },
      runtime,
    );

    expect(firstPage.listings.map((listing) => listing.id)).toEqual(["cached:1"]);
    expect(secondPage.listings.map((listing) => listing.id)).toEqual(["cached:2"]);
    expect(searchCalls).toBe(1);
    expect(secondPage.pagination.hasMore).toBe(false);
    expect(renderMetrics()).toContain(
      'closetsearch_provider_cache_total{provider="cached",status="miss"} 1',
    );
    expect(renderMetrics()).toContain(
      'closetsearch_provider_cache_total{provider="cached",status="fresh"} 1',
    );
  });

  it("does not crash when a provider omits pagination metadata", async () => {
    const provider: Provider = {
      id: "missing-pagination",
      name: "Missing Pagination",
      async search() {
        return {
          providerId: "missing-pagination",
          status: "success",
          listings: [createListing("missing-pagination:1")],
        };
      },
    };

    const result = await runProviderSearch(
      { text: "jacket", pageSize: 1 },
      createRuntime([{ mode: "real", name: provider.name, provider }]),
    );

    expect(result.listings).toHaveLength(1);
    expect(result.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      hasMore: false,
    });
  });

  it("ignores malformed provider listings instead of crashing the whole page", async () => {
    const provider: Provider = {
      id: "malformed",
      name: "Malformed Provider",
      async search() {
        return {
          providerId: "malformed",
          status: "success",
          listings: [
            createListing("malformed:good-1"),
            {
              ...createListing("malformed:bad-1"),
              source: {
                id: "malformed",
              },
            } as unknown as Listing,
          ],
          pagination: {
            page: 1,
            pageSize: 24,
            hasMore: false,
            totalCount: 2,
          },
        };
      },
    };

    const result = await runProviderSearch(
      { text: "jacket", pageSize: 24 },
      createRuntime([{ mode: "real", name: provider.name, provider }]),
    );

    expect(result.listings).toEqual([createListing("malformed:good-1")]);
    expect(result.providers).toMatchObject([
      {
        degraded: true,
        providerId: "malformed",
        providerName: "Malformed Provider",
        status: "success",
        resultCount: 1,
        warnings: ["Dropped 1 malformed provider listings."],
      },
    ]);
  });
});
