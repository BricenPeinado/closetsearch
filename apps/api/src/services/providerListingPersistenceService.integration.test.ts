import { randomUUID } from "node:crypto";
import type { Provider } from "@closetsearch/providers";
import type { Listing } from "@closetsearch/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import { resetProviderSearchCache } from "../providers/orchestrator.js";
import type { ProviderRuntime } from "../providers/registry.js";
import { loadProviderRuntimeConfig } from "../providers/runtime-config.js";
import { searchListings } from "../search-service.js";
import { DurableEngagementService } from "./durableEngagementService.js";

const runtime = vi.hoisted(() => ({
  dataPlane: undefined as PostgresDataPlane | undefined,
}));

vi.mock("../db/persistence-runtime.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/persistence-runtime.js")>();

  return {
    ...original,
    getPostgresDataPlane: async () => {
      if (!runtime.dataPlane) {
        throw new Error("Test PostgreSQL data plane is not initialized.");
      }

      return runtime.dataPlane;
    },
  };
});

const listing: Listing = {
  analyticsEligibility: { eligible: true },
  brand: {
    id: "brand:acme",
    name: "Acme",
    slug: "acme",
  },
  fetchedAt: "2026-07-24T12:00:00.000Z",
  freshness: {
    observedAt: "2026-07-24T12:00:00.000Z",
    status: "fresh",
  },
  id: "ebay:search-listing-1",
  imageUrl: "https://images.example.com/search-listing-1.jpg",
  lifecycle: {
    observedAt: "2026-07-24T12:00:00.000Z",
    status: "active",
  },
  listingType: "buy_now",
  market: {
    status: "active",
  },
  price: {
    amount: 125,
    amountMinor: 12_500,
    currency: "USD",
    fractionDigits: 2,
  },
  providerId: "ebay",
  providerListingId: "search-listing-1",
  source: {
    dataOrigin: "official_api",
    id: "ebay",
    isMock: false,
    name: "eBay",
  },
  sourceUrl: "https://www.ebay.com/itm/search-listing-1",
  title: "Acme server-normalized jacket",
};

function providerRuntime(provider: Provider): ProviderRuntime {
  return {
    activeProviders: [
      {
        mode: "real",
        name: provider.name,
        provider,
      },
    ],
    config: loadProviderRuntimeConfig({}),
    preflightFailures: [],
    statuses: [],
  };
}

describe("provider result persistence", () => {
  let harness: Awaited<ReturnType<typeof createPostgresTestHarness>>;
  let originalDriver: string | undefined;

  beforeEach(async () => {
    originalDriver = process.env.PERSISTENCE_DRIVER;
    process.env.PERSISTENCE_DRIVER = "postgres";
    harness = await createPostgresTestHarness();
    runtime.dataPlane = harness.dataPlane;
    resetProviderSearchCache();
  });

  afterEach(async () => {
    resetProviderSearchCache();
    runtime.dataPlane = undefined;
    await harness.database.close();

    if (originalDriver === undefined) {
      delete process.env.PERSISTENCE_DRIVER;
    } else {
      process.env.PERSISTENCE_DRIVER = originalDriver;
    }
  });

  it("makes a search result durable before accepting its viewport event", async () => {
    const provider: Provider = {
      id: "ebay",
      name: "eBay",
      async search() {
        return {
          listings: [listing],
          pagination: {
            hasMore: false,
            page: 1,
            pageSize: 12,
            totalCount: 1,
          },
          providerId: "ebay",
          status: "success",
        };
      },
    };
    const response = await searchListings(
      {
        pageSize: 12,
        sort: "relevance",
        text: "acme",
      },
      providerRuntime(provider),
    );

    expect(response.listings).toHaveLength(1);
    await expect(
      harness.dataPlane.listings.resolveInternalId(listing.providerId, listing.providerListingId),
    ).resolves.toEqual(expect.any(String));

    const occurredAt = new Date("2026-07-24T12:05:00.000Z");
    const engagement = new DurableEngagementService(
      harness.dataPlane,
      {
        futureToleranceMs: 300_000,
        maxEventAgeMs: 604_800_000,
        sessionPepper: "provider-listing-persistence-test-engagement-pepper",
      },
      () => occurredAt,
    );

    await expect(
      engagement.recordClientEvent(
        {
          privacySessionId: "provider-persistence-session",
        },
        {
          eventId: randomUUID(),
          eventType: "listing_view",
          listingId: listing.id,
          occurredAt: occurredAt.toISOString(),
          viewportDurationMs: 1_500,
        },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
    });
  });
});
