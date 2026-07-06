import type { Provider } from "@closetsearch/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFeed } from "./feed-service.js";
import {
  resetProviderSearchCache,
} from "./providers/orchestrator.js";
import type { ProviderRuntime } from "./providers/registry.js";
import { createProviderRuntime } from "./providers/registry.js";
import { loadProviderRuntimeConfig } from "./providers/runtime-config.js";
import { searchListings } from "./search-service.js";
import { resetEngagementStore } from "./services/engagementService.js";
import { resetListingCatalog } from "./services/listingCatalogService.js";
import { resetLikeStore } from "./like-service.js";
import { cleanupIsolatedDatabase, useIsolatedDatabase } from "./db/test-helpers.js";
import { resetRecentSearchStore } from "./recent-search-service.js";
import { resetSavedSearchStore } from "./saved-search-service.js";
import { resetUserStore } from "./user-service.js";

function createRuntime(activeProviders: ProviderRuntime["activeProviders"]): ProviderRuntime {
  return {
    config: loadProviderRuntimeConfig({}),
    activeProviders,
    preflightFailures: [],
    statuses: [],
  };
}

describe("feed and search pagination", () => {
  let databasePath = "";

  beforeEach(() => {
    databasePath = useIsolatedDatabase("pagination");
    resetProviderSearchCache();
    resetEngagementStore();
    resetListingCatalog();
    resetLikeStore();
    resetUserStore();
    resetRecentSearchStore();
    resetSavedSearchStore();
  });

  afterEach(() => {
    cleanupIsolatedDatabase(databasePath);
  });

  it("returns normalized pagination for the first feed page", async () => {
    const runtime = createProviderRuntime(loadProviderRuntimeConfig({}));
    const response = await getFeed({ pageSize: 2 }, runtime);

    expect(response.listings).toHaveLength(2);
    expect(response.pagination).toEqual({
      page: 1,
      pageSize: 2,
      hasMore: true,
      nextPage: 2,
      nextCursor: expect.any(String),
      totalCount: 6,
    });
  });

  it("loads the next feed page through the normalized cursor", async () => {
    const runtime = createProviderRuntime(loadProviderRuntimeConfig({}));
    const firstPage = await getFeed({ pageSize: 2 }, runtime);
    const secondPage = await getFeed(
      {
        cursor: firstPage.pagination.nextCursor,
        pageSize: 2,
      },
      runtime,
    );

    expect(secondPage.pagination.page).toBe(2);
    expect(secondPage.listings).toHaveLength(2);
    expect(secondPage.listings.map((listing) => listing.id)).not.toEqual(
      firstPage.listings.map((listing) => listing.id),
    );
  });

  it("returns normalized pagination for the first search page", async () => {
    const runtime = createProviderRuntime(loadProviderRuntimeConfig({}));
    const response = await searchListings(
      {
        text: "jacket",
        listingTypes: ["buy_now"],
        sort: "price_asc",
        pageSize: 1,
      },
      runtime,
    );

    expect(response.query).toMatchObject({
      text: "jacket",
      listingTypes: ["buy_now"],
      sort: "price_asc",
      page: 1,
      pageSize: 1,
    });
    expect(response.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      hasMore: true,
      nextPage: 2,
      nextCursor: expect.any(String),
    });
    expect(response.listings).toHaveLength(1);
  });

  it("loads the next search page while preserving query, filters, and sort", async () => {
    const runtime = createProviderRuntime(loadProviderRuntimeConfig({}));
    const firstPage = await searchListings(
      {
        text: "jacket",
        listingTypes: ["buy_now"],
        sort: "price_asc",
        pageSize: 1,
      },
      runtime,
    );
    const secondPage = await searchListings(
      {
        text: "jacket",
        listingTypes: ["buy_now"],
        sort: "price_asc",
        cursor: firstPage.pagination.nextCursor,
        pageSize: 1,
      },
      runtime,
    );

    expect(secondPage.query).toMatchObject({
      text: "jacket",
      listingTypes: ["buy_now"],
      sort: "price_asc",
      page: 2,
      pageSize: 1,
    });
    expect(secondPage.listings).toHaveLength(1);
    expect(secondPage.listings[0]?.id).not.toBe(firstPage.listings[0]?.id);
  });

  it("ignores a stale cursor when the search query changes", async () => {
    const runtime = createProviderRuntime(loadProviderRuntimeConfig({}));
    const firstPage = await searchListings(
      {
        text: "jacket",
        pageSize: 1,
      },
      runtime,
    );
    const resetPage = await searchListings(
      {
        text: "sweater",
        sort: "newest",
        cursor: firstPage.pagination.nextCursor,
        pageSize: 1,
      },
      runtime,
    );

    expect(resetPage.query).toMatchObject({
      text: "sweater",
      sort: "newest",
      page: 1,
      pageSize: 1,
    });
    expect(resetPage.listings[0]?.title.toLowerCase()).toContain("sweater");
  });

  it("throws a recoverable API error when pagination fails on a later provider page", async () => {
    const flakyProvider: Provider = {
      id: "flaky",
      name: "Flaky Provider",
      capabilities: {
        supportsPagination: true,
        supportsPagePagination: true,
      },
      async search(request) {
        if ((request.pagination?.page ?? 1) === 2) {
          throw new Error("Later page failed.");
        }

        return {
          providerId: "flaky",
          status: "success",
          listings: [
            {
              id: "flaky:1",
              providerId: "flaky",
              providerListingId: "1",
              source: { id: "flaky", name: "Flaky Provider" },
              sourceUrl: "https://example.com/flaky-1",
              title: "Flaky page 1 listing",
              brand: { id: "brand:flaky", slug: "flaky", name: "Flaky" },
              imageUrl: "https://example.com/flaky-1.jpg",
              price: { amount: 100, currency: "USD" },
              listingType: "buy_now",
              fetchedAt: "2026-06-13T12:00:00.000Z",
            },
          ],
          pagination: {
            page: 1,
            pageSize: 1,
            hasMore: true,
            nextPage: 2,
            totalCount: 2,
          },
        };
      },
    };
    const runtime = createRuntime([{ mode: "real", name: flakyProvider.name, provider: flakyProvider }]);
    const firstPage = await searchListings(
      { text: "flaky", pageSize: 1 },
      runtime,
    );

    await expect(
      searchListings(
        {
          text: "flaky",
          cursor: firstPage.pagination.nextCursor,
          pageSize: 1,
        },
        runtime,
      ),
    ).rejects.toMatchObject({
      code: "search_unavailable",
      statusCode: 502,
    });
  });

  it("does not crash when provider pagination metadata is missing", async () => {
    const noPaginationProvider: Provider = {
      id: "no-pagination",
      name: "No Pagination",
      async search() {
        return {
          providerId: "no-pagination",
          status: "success",
          listings: [
            {
              id: "no-pagination:1",
              providerId: "no-pagination",
              providerListingId: "1",
              source: { id: "no-pagination", name: "No Pagination" },
              sourceUrl: "https://example.com/no-pagination-1",
              title: "No pagination listing",
              brand: { id: "brand:no-pagination", slug: "no-pagination", name: "No Pagination" },
              imageUrl: "https://example.com/no-pagination-1.jpg",
              price: { amount: 100, currency: "USD" },
              listingType: "buy_now",
              fetchedAt: "2026-06-13T12:00:00.000Z",
            },
          ],
        };
      },
    };
    const runtime = createRuntime([{ mode: "real", name: noPaginationProvider.name, provider: noPaginationProvider }]);
    const response = await searchListings(
      { text: "test", pageSize: 1 },
      runtime,
    );

    expect(response.listings).toHaveLength(1);
    expect(response.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      hasMore: false,
    });
  });

  it("keeps mock fallback working when real mode cannot activate the real provider", async () => {
    const runtime = createProviderRuntime(
      loadProviderRuntimeConfig({
        PROVIDER_RUNTIME_MODE: "real",
        GRAILED_PROVIDER_ENABLED: "true",
      }),
    );
    const response = await searchListings(
      { text: "jacket", pageSize: 2 },
      runtime,
    );

    expect(response.listings).toHaveLength(2);
    expect(response.providers.some((provider) => provider.providerId === "mock")).toBe(true);
  });
});
