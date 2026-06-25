import type { Provider, ProviderSearchFailure, ProviderSearchResponse } from "@closetsearch/providers";
import type { Listing, SearchQuery } from "@closetsearch/shared";
import { describe, expect, it } from "vitest";
import { runProviderSearch } from "./orchestrator.js";
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
    sourceUrl: `https://example.com/${id}`,
    title: `Listing ${id}`,
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
  it("captures provider failures without breaking the normalized response", async () => {
    const successProvider: Provider = {
      id: "mock",
      name: "Mock Closet",
      async search() {
        return {
          providerId: "mock",
          status: "success",
          listings: [createListing("mock:success-1")],
        };
      },
    };
    const failingProvider: Provider = {
      id: "throwing",
      name: "Throwing Provider",
      async search() {
        throw new Error("Provider request failed.");
      },
    };

    const result = await runProviderSearch(
      { text: "jacket" },
      createRuntime([
        { mode: "mock", name: successProvider.name, provider: successProvider },
        { mode: "real", name: failingProvider.name, provider: failingProvider },
      ]),
    );

    expect(result.listings).toHaveLength(1);
    expect(result.providers).toEqual([
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
      }),
    ]);
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
        };
      },
    };

    const result = await runProviderSearch(
      { text: "jacket" },
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
});
