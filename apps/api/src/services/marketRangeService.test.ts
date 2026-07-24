import type { PriceSnapshot } from "@closetsearch/shared";
import { describe, expect, it } from "vitest";
import {
  buildBrandMarketSummaries,
  buildCategoryMarketSummaries,
  buildUnderMarketSignals,
  compareListingToObservedMarket,
} from "./marketRangeService.js";

function createSnapshot(
  overrides: Partial<PriceSnapshot> & {
    brand?: string;
    category?: string;
    id: string;
    listingId?: string;
    priceAmount: number;
  },
): PriceSnapshot {
  const sourceListingId = overrides.sourceListingId ?? overrides.id;
  const listingId = overrides.listingId ?? `mock:${sourceListingId}`;
  const observedAt = overrides.observedAt ?? "2026-07-16T12:00:00.000Z";
  const lastSeenAt = overrides.lastSeenAt ?? observedAt;

  return {
    id: overrides.id,
    observationSequence: overrides.observationSequence ?? 1,
    listingId,
    source: overrides.source ?? "mock",
    sourceListingId,
    brand: overrides.brand,
    category: overrides.category,
    title: overrides.title ?? `${overrides.brand ?? "Brand"} listing`,
    imageUrl: overrides.imageUrl,
    priceAmount: overrides.priceAmount,
    priceCurrency: overrides.priceCurrency ?? "USD",
    normalizedPriceAmount: overrides.normalizedPriceAmount ?? overrides.priceAmount,
    normalizedPriceCurrency: overrides.normalizedPriceCurrency ?? "USD",
    condition: overrides.condition ?? "good",
    size: overrides.size,
    listingType: overrides.listingType ?? "buy_now",
    marketStatus: overrides.marketStatus ?? "active",
    sourceUrl: overrides.sourceUrl ?? `https://mock.example/listings/${sourceListingId}`,
    observedAt,
    lastSeenAt,
  };
}

describe("marketRangeService", () => {
  it("computes min, max, median, average, and groups by brand and category", () => {
    const snapshots = [
      createSnapshot({ id: "kapital-1", brand: "Kapital", category: "jackets", priceAmount: 100 }),
      createSnapshot({ id: "kapital-2", brand: "Kapital", category: "jackets", priceAmount: 200 }),
      createSnapshot({ id: "kapital-3", brand: "Kapital", category: "jackets", priceAmount: 300 }),
      createSnapshot({ id: "kapital-4", brand: "Kapital", category: "jackets", priceAmount: 500 }),
      createSnapshot({
        id: "undercover-1",
        brand: "Undercover",
        category: "tops",
        priceAmount: 90,
      }),
    ];

    const brandSummaries = buildBrandMarketSummaries(snapshots);
    const categorySummaries = buildCategoryMarketSummaries(snapshots);

    expect(brandSummaries[0]).toMatchObject({
      brand: "Kapital",
      range: {
        count: 4,
        minPrice: 100,
        maxPrice: 500,
        medianPrice: 250,
        averagePrice: 275,
      },
    });
    expect(categorySummaries.find((summary) => summary.category === "jackets")).toMatchObject({
      category: "jackets",
      range: {
        count: 4,
        medianPrice: 250,
      },
    });
  });

  it("returns limited data when too few comparable listings exist", () => {
    const target = createSnapshot({
      id: "target",
      brand: "Kapital",
      category: "jackets",
      priceAmount: 180,
    });
    const comparables = [
      createSnapshot({ id: "comp-1", brand: "Kapital", category: "jackets", priceAmount: 200 }),
      createSnapshot({ id: "comp-2", brand: "Kapital", category: "jackets", priceAmount: 220 }),
      createSnapshot({ id: "comp-3", brand: "Kapital", category: "jackets", priceAmount: 240 }),
    ];

    const comparison = compareListingToObservedMarket(target, [target, ...comparables]);

    expect(comparison).toMatchObject({
      comparableCount: 3,
      label: "Not enough observed data",
      status: "limited_data",
    });
  });

  it("avoids comparison when only mismatched currencies are available", () => {
    const target = createSnapshot({
      id: "target",
      brand: "Kapital",
      category: "jackets",
      priceAmount: 180,
      normalizedPriceCurrency: "USD",
      priceCurrency: "USD",
    });
    const comparables = [
      createSnapshot({
        id: "comp-1",
        brand: "Kapital",
        category: "jackets",
        priceAmount: 200,
        normalizedPriceCurrency: "EUR",
        priceCurrency: "EUR",
      }),
      createSnapshot({
        id: "comp-2",
        brand: "Kapital",
        category: "jackets",
        priceAmount: 220,
        normalizedPriceCurrency: "EUR",
        priceCurrency: "EUR",
      }),
      createSnapshot({
        id: "comp-3",
        brand: "Kapital",
        category: "jackets",
        priceAmount: 240,
        normalizedPriceCurrency: "EUR",
        priceCurrency: "EUR",
      }),
      createSnapshot({
        id: "comp-4",
        brand: "Kapital",
        category: "jackets",
        priceAmount: 260,
        normalizedPriceCurrency: "EUR",
        priceCurrency: "EUR",
      }),
    ];

    const comparison = compareListingToObservedMarket(target, [target, ...comparables]);

    expect(comparison).toMatchObject({
      comparableCount: 4,
      label: "Limited data",
      status: "currency_mismatch",
    });
  });

  it("keeps grouped market summaries separated by comparison currency", () => {
    const summaries = buildBrandMarketSummaries([
      createSnapshot({
        id: "usd-1",
        brand: "Kapital",
        category: "jackets",
        priceAmount: 100,
        normalizedPriceCurrency: "USD",
      }),
      createSnapshot({
        id: "eur-1",
        brand: "Kapital",
        category: "jackets",
        priceAmount: 90,
        normalizedPriceCurrency: "EUR",
        priceCurrency: "EUR",
      }),
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries.map((summary) => summary.range.currency).sort()).toEqual(["EUR", "USD"]);
    expect(summaries.every((summary) => summary.range.count === 1)).toBe(true);
  });

  it("identifies cautious below-range signals from observed listings", () => {
    const target = createSnapshot({
      id: "target",
      brand: "Kapital",
      category: "jackets",
      priceAmount: 120,
      title: "Kapital lower-priced jacket",
    });
    const comparables = [
      createSnapshot({ id: "comp-1", brand: "Kapital", category: "jackets", priceAmount: 180 }),
      createSnapshot({ id: "comp-2", brand: "Kapital", category: "jackets", priceAmount: 200 }),
      createSnapshot({ id: "comp-3", brand: "Kapital", category: "jackets", priceAmount: 220 }),
      createSnapshot({ id: "comp-4", brand: "Kapital", category: "jackets", priceAmount: 260 }),
    ];

    const signals = buildUnderMarketSignals([target, ...comparables]);

    expect(signals[0]).toMatchObject({
      label: "Below observed range",
      listingId: target.listingId,
      observedMinPrice: 180,
      observedMedianPrice: 210,
      currentPrice: 120,
    });
    expect(signals[0]?.summary.toLowerCase()).toContain("observed");
    expect(signals[0]?.summary.toLowerCase()).not.toContain("profit");
  });

  it("orders signals within currency groups instead of comparing raw cross-currency deltas", () => {
    const snapshots = [
      createSnapshot({
        id: "usd-target",
        brand: "Kapital",
        category: "jackets",
        priceAmount: 1,
        normalizedPriceCurrency: "USD",
      }),
      ...[1_000, 1_100, 1_200, 1_300].map((priceAmount, index) =>
        createSnapshot({
          id: `usd-${index}`,
          brand: "Kapital",
          category: "jackets",
          priceAmount,
          normalizedPriceCurrency: "USD",
        }),
      ),
      createSnapshot({
        id: "jpy-target",
        brand: "Visvim",
        category: "shoes",
        priceAmount: 100,
        normalizedPriceAmount: 100,
        normalizedPriceCurrency: "JPY",
        priceCurrency: "JPY",
      }),
      ...[200, 220, 240, 260].map((priceAmount, index) =>
        createSnapshot({
          id: `jpy-${index}`,
          brand: "Visvim",
          category: "shoes",
          priceAmount,
          normalizedPriceAmount: priceAmount,
          normalizedPriceCurrency: "JPY",
          priceCurrency: "JPY",
        }),
      ),
    ];

    const signals = buildUnderMarketSignals(snapshots);
    const currencies = signals.map((signal) => signal.currentCurrency);

    expect(currencies).toContain("JPY");
    expect(currencies).toContain("USD");
    expect(currencies).toEqual([...currencies].sort());
  });
});
