import type { Listing } from "@closetsearch/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupIsolatedDatabase, useIsolatedDatabase } from "../db/test-helpers.js";
import {
  getLatestObservedPriceSnapshots,
  getObservedPriceSnapshots,
  recordObservedListings,
  resetPriceSnapshotStore,
} from "./priceSnapshotService.js";

const now = new Date("2026-07-16T12:00:00.000Z").getTime();

function createListing(
  overrides: Partial<Listing> & {
    brandName?: string;
    id: string;
    priceAmount?: number;
    sourceId?: string;
  },
): Listing {
  const sourceId = overrides.sourceId ?? overrides.source?.id ?? "grailed";
  const providerListingId =
    overrides.providerListingId ?? overrides.id.split(":").pop() ?? overrides.id;
  const brandName = overrides.brandName ?? overrides.brand?.name ?? "Kapital";
  const brandSlug = brandName.toLowerCase().replace(/\s+/g, "-") || "unknown-brand";

  return {
    id: overrides.id,
    providerId: overrides.providerId ?? sourceId,
    providerListingId,
    source: overrides.source ?? {
      id: sourceId,
      name: sourceId === "grailed" ? "Grailed" : sourceId.toUpperCase(),
    },
    sourceUrl: overrides.sourceUrl ?? `https://${sourceId}.example/listings/${providerListingId}`,
    title: overrides.title ?? `${brandName} piece`,
    brand: overrides.brand ?? {
      id: `brand:${brandSlug}`,
      slug: brandSlug,
      name: brandName,
    },
    imageUrl: overrides.imageUrl ?? `https://cdn.example.com/${providerListingId}.jpg`,
    price: overrides.price ?? {
      amount: overrides.priceAmount ?? 200,
      currency: "USD",
    },
    category: overrides.category,
    size: overrides.size,
    condition: overrides.condition ?? "good",
    listingType: overrides.listingType ?? "buy_now",
    fetchedAt: overrides.fetchedAt ?? new Date(now).toISOString(),
    market: overrides.market,
    riskSignal: overrides.riskSignal,
    seller: overrides.seller,
  };
}

function waitForNextTick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe("priceSnapshotService", () => {
  let databasePath = "";

  beforeEach(() => {
    databasePath = useIsolatedDatabase("price-snapshots");
    resetPriceSnapshotStore();
  });

  afterEach(() => {
    cleanupIsolatedDatabase(databasePath);
  });

  it("records new listing observations", () => {
    recordObservedListings([
      createListing({
        id: "grailed:kapital-jacket-1",
        brandName: "Kapital",
        category: "jackets",
        priceAmount: 180,
      }),
    ]);

    expect(getObservedPriceSnapshots()).toMatchObject([
      {
        brand: "Kapital",
        category: "jackets",
        normalizedPriceAmount: 180,
        normalizedPriceCurrency: "USD",
      },
    ]);
  });

  it("skips duplicate same-price observations and refreshes lastSeenAt", async () => {
    recordObservedListings([
      createListing({
        id: "grailed:kapital-jacket-1",
        brandName: "Kapital",
        category: "jackets",
        priceAmount: 180,
      }),
    ]);

    const firstSnapshot = getObservedPriceSnapshots()[0];
    await waitForNextTick();

    recordObservedListings([
      createListing({
        id: "grailed:kapital-jacket-1",
        brandName: "Kapital",
        category: "jackets",
        priceAmount: 180,
        title: "Kapital jacket updated title",
      }),
    ]);

    const snapshots = getObservedPriceSnapshots();

    expect(snapshots).toHaveLength(1);
    expect(new Date(snapshots[0].lastSeenAt).getTime()).toBeGreaterThan(
      new Date(firstSnapshot.lastSeenAt).getTime(),
    );
  });

  it("uses a monotonic sequence for repeated same-timestamp price changes", () => {
    const observedAt = "2026-07-16T12:00:00.000Z";

    recordObservedListings(
      [
        createListing({
          id: "grailed:kapital-jacket-1",
          brandName: "Kapital",
          category: "jackets",
          priceAmount: 180,
        }),
      ],
      observedAt,
    );

    recordObservedListings(
      [
        createListing({
          id: "grailed:kapital-jacket-1",
          brandName: "Kapital",
          category: "jackets",
          priceAmount: 140,
        }),
      ],
      observedAt,
    );

    recordObservedListings(
      [
        createListing({
          id: "grailed:kapital-jacket-1",
          brandName: "Kapital",
          category: "jackets",
          priceAmount: 180,
        }),
      ],
      observedAt,
    );

    const snapshots = getObservedPriceSnapshots();

    expect(snapshots).toHaveLength(3);
    expect(snapshots.map((snapshot) => snapshot.normalizedPriceAmount)).toEqual([180, 140, 180]);
    expect(snapshots.map((snapshot) => snapshot.observationSequence)).toEqual([3, 2, 1]);
    expect(getLatestObservedPriceSnapshots()[0]).toMatchObject({
      normalizedPriceAmount: 180,
      observationSequence: 3,
    });
  });

  it("handles missing category or unusable prices safely", () => {
    recordObservedListings([
      createListing({
        id: "grailed:brand-only-piece",
        brandName: "Helmut Lang",
        category: undefined,
        priceAmount: 250,
      }),
      createListing({
        id: "grailed:invalid-price",
        brandName: "Helmut Lang",
        category: "jackets",
        price: {
          amount: 0,
          currency: "USD",
        },
      }),
    ]);

    const snapshots = getObservedPriceSnapshots();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      brand: "Helmut Lang",
      category: undefined,
      normalizedPriceAmount: 250,
    });
  });
});
