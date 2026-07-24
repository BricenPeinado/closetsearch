import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { ListingObservationInput } from "../db/postgres/model.js";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import { PostgresObservedAnalyticsService } from "./postgresAnalyticsService.js";

const observedAt = new Date("2026-07-24T12:00:00.000Z");

function observation(
  sourceListingId: string,
  options: {
    brand?: string;
    category?: string;
    currency?: string;
    marketStatus: "active" | "sold";
    priceMinor: bigint;
  },
): ListingObservationInput {
  return {
    analyticsEligible: true,
    availability: options.marketStatus === "sold" ? "sold" : "available",
    category: options.category ?? "jackets",
    condition: "good",
    fetchedAt: observedAt,
    id: randomUUID(),
    idempotencyKey: `${sourceListingId}:${options.marketStatus}`,
    images: [
      {
        url: `https://cdn.example/${sourceListingId}.jpg`,
      },
    ],
    listingType: "buy_now",
    marketStatus: options.marketStatus,
    observedAt,
    originalPrice: {
      amountMinor: options.priceMinor,
      currency: options.currency ?? "USD",
    },
    providerBrand: options.brand ?? "Kapital",
    providerId: "fixture-provider",
    soldPrice:
      options.marketStatus === "sold"
        ? {
            amountMinor: options.priceMinor,
            currency: options.currency ?? "USD",
          }
        : undefined,
    sourceListingId,
    sourceMarketplace: "Fixture Market",
    sourceUrl: `https://market.example/${sourceListingId}`,
    title: `Kapital jacket ${sourceListingId}`,
  };
}

describe("PostgreSQL observed analytics", () => {
  const harnesses: Array<Awaited<ReturnType<typeof createPostgresTestHarness>>> = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.database.close()));
  });

  it("keeps sold and asking observations distinct and prioritizes sold ranges", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);

    for (const [index, priceMinor] of [12_000n, 15_000n, 18_000n, 21_000n].entries()) {
      await harness.dataPlane.listings.upsertObservation(
        observation(`sold-${index + 1}`, {
          marketStatus: "sold",
          priceMinor,
        }),
      );
    }

    await harness.dataPlane.listings.upsertObservation(
      observation("active-1", {
        marketStatus: "active",
        priceMinor: 10_000n,
      }),
    );

    const service = new PostgresObservedAnalyticsService(harness.dataPlane);

    await expect(service.getOverview()).resolves.toMatchObject({
      askingComparableCount: 1,
      observedListingCount: 5,
      soldComparableCount: 4,
      sourceCoverage: ["fixture-provider"],
    });
    await expect(service.getMarketInsights()).resolves.toMatchObject({
      basis: "confirmed_sold",
      comparableCount: 4,
      brandSummaries: [
        expect.objectContaining({
          brand: "Kapital",
          range: expect.objectContaining({
            count: 4,
            medianPrice: 165,
          }),
        }),
      ],
    });
    await expect(service.getUnderpricedSignals()).resolves.toMatchObject({
      basis: "observed_asking",
      disclaimer: expect.stringContaining("do not imply guaranteed"),
    });
  });

  it("uses each currency's documented minor-unit precision", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    await harness.dataPlane.listings.upsertObservation(
      observation("jpy-active", {
        currency: "JPY",
        marketStatus: "active",
        priceMinor: 12_500n,
      }),
    );
    await harness.dataPlane.listings.upsertObservation(
      observation("bhd-active", {
        currency: "BHD",
        marketStatus: "active",
        priceMinor: 12_500n,
      }),
    );

    const snapshots = await new PostgresObservedAnalyticsService(
      harness.dataPlane,
    ).listLatestSnapshots();
    const byCurrency = new Map(
      snapshots.map((snapshot) => [snapshot.priceCurrency, snapshot.priceAmount]),
    );

    expect(byCurrency.get("JPY")).toBe(12_500);
    expect(byCurrency.get("BHD")).toBe(12.5);
  });

  it("uses sold data per segment without dropping asking-only segments", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);

    for (let index = 0; index < 4; index += 1) {
      await harness.dataPlane.listings.upsertObservation(
        observation(`kapital-sold-${index}`, {
          brand: "Kapital",
          category: "jackets",
          marketStatus: "sold",
          priceMinor: BigInt(15_000 + index * 1_000),
        }),
      );
      await harness.dataPlane.listings.upsertObservation(
        observation(`visvim-active-${index}`, {
          brand: "Visvim",
          category: "shoes",
          marketStatus: "active",
          priceMinor: BigInt(25_000 + index * 1_000),
        }),
      );
    }

    const insights = await new PostgresObservedAnalyticsService(
      harness.dataPlane,
    ).getMarketInsights();

    expect(insights).toMatchObject({
      basis: "segment_sold_first",
      comparableCount: 8,
    });
    expect(insights.brandSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          basis: "confirmed_sold",
          brand: "Kapital",
          range: expect.objectContaining({ count: 4, currency: "USD" }),
        }),
        expect.objectContaining({
          basis: "observed_asking",
          brand: "Visvim",
          range: expect.objectContaining({ count: 4, currency: "USD" }),
        }),
      ]),
    );
  });

  it("excludes listings whose current lifecycle is stale", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const persisted = await harness.dataPlane.listings.upsertObservation(
      observation("stale-active", {
        marketStatus: "active",
        priceMinor: 15_000n,
      }),
    );
    await harness.database.query(
      `UPDATE listing_current_state
       SET availability = 'stale'
       WHERE listing_id = $1`,
      [persisted.listingId],
    );

    await expect(
      new PostgresObservedAnalyticsService(harness.dataPlane).listLatestSnapshots(),
    ).resolves.toEqual([]);
  });
});
