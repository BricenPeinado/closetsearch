import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { ListingObservationInput } from "../db/postgres/model.js";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import { PriceTrendService } from "./priceTrendService.js";

function observation(input: {
  amountMinor: bigint;
  idempotencyKey: string;
  observedAt: string;
  sourceListingId?: string;
}): ListingObservationInput {
  const observedAt = new Date(input.observedAt);

  return {
    analyticsEligible: true,
    availability: "available",
    category: "jackets",
    condition: "good",
    fetchedAt: observedAt,
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    images: [{ url: "https://images.example/trend.jpg" }],
    landedPrice: {
      amountMinor: input.amountMinor + 1_000n,
      currency: "USD",
    },
    listingType: "buy_now",
    marketStatus: "active",
    observedAt,
    originalPrice: {
      amountMinor: input.amountMinor,
      currency: "USD",
    },
    providerBrand: "Kapital",
    providerId: "fixture-provider",
    sourceListingId: input.sourceListingId ?? "trend-1",
    sourceMarketplace: "Fixture Market",
    sourceUrl: "https://market.example/trend-1",
    title: "Kapital jacket",
  };
}

describe("PriceTrendService", () => {
  const harnesses: Array<Awaited<ReturnType<typeof createPostgresTestHarness>>> = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.database.close()));
  });

  it("returns exact quartiles, IQR, typed counts, freshness, and bounded changes", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const samples = [
      ["2025-07-20T12:00:00.000Z", 10_000n],
      ["2026-04-20T12:00:00.000Z", 11_000n],
      ["2026-06-20T12:00:00.000Z", 12_000n],
      ["2026-07-10T12:00:00.000Z", 13_000n],
      ["2026-07-25T12:00:00.000Z", 14_000n],
    ] as const;

    for (const [index, [observedAt, amountMinor]] of samples.entries()) {
      await harness.dataPlane.listings.upsertObservation(
        observation({
          amountMinor,
          idempotencyKey: `trend-${index}`,
          observedAt,
        }),
      );
    }

    const trend = await new PriceTrendService(
      harness.dataPlane,
      () => new Date("2026-07-26T12:00:00.000Z"),
    ).getListingTrend("fixture-provider:trend-1");

    expect(trend).toMatchObject({
      counts: {
        byMarketStatus: { active: 5, sold: 0, unknown: 0 },
        byMarketplace: { "Fixture Market": 5 },
        byObservationKind: {
          asking: 5,
          completed_auction: 0,
          confirmed_sold: 0,
          current_bid: 0,
        },
      },
      currency: "USD",
      state: "ready",
      summary: {
        freshness: {
          ageSeconds: 86_400,
          isStale: false,
          status: "fresh",
        },
        iqrMinor: 2_000,
        medianMinor: 12_000,
        q1Minor: 11_000,
        q3Minor: 13_000,
        sampleSize: 5,
      },
    });
    expect(trend?.summary.changes.days7).toMatchObject({
      absoluteMinor: 1_000,
      baselineAmountMinor: 13_000,
      percent: 7.69,
    });
    expect(trend?.summary.changes.days365).toMatchObject({
      absoluteMinor: 4_000,
      baselineAmountMinor: 10_000,
      percent: 40,
    });
  });

  it("keeps live bids distinct from completed auction evidence", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const live = observation({
      amountMinor: 20_000n,
      idempotencyKey: "auction-live",
      observedAt: "2026-07-25T10:00:00.000Z",
      sourceListingId: "auction-1",
    });
    live.listingType = "auction";
    live.observationKind = "current_bid";
    live.auctionCurrentBid = {
      amountMinor: 20_000n,
      currency: "USD",
    };
    live.bidCount = 4;
    live.auctionEndsAt = new Date("2026-07-27T10:00:00.000Z");
    await harness.dataPlane.listings.upsertObservation(live);

    const trend = await new PriceTrendService(harness.dataPlane).getListingTrend(
      "fixture-provider:auction-1",
    );

    expect(trend).toMatchObject({
      counts: {
        byMarketStatus: { active: 1, sold: 0, unknown: 0 },
        byObservationKind: {
          current_bid: 1,
          confirmed_sold: 0,
        },
      },
      state: "insufficient_data",
    });
    expect(trend?.series[0]).toMatchObject({
      amountMinor: 20_000,
      bidCount: 4,
      marketStatus: "active",
      observationKind: "current_bid",
    });
  });

  it("returns an explicit no-data state when filters exclude the listing provider", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    await harness.dataPlane.listings.upsertObservation(
      observation({
        amountMinor: 10_000n,
        idempotencyKey: "filtered",
        observedAt: "2026-07-25T12:00:00.000Z",
      }),
    );

    await expect(
      new PriceTrendService(harness.dataPlane).getListingTrend("fixture-provider:trend-1", {
        providerIds: ["other-provider"],
      }),
    ).resolves.toMatchObject({
      series: [],
      state: "no_data",
    });
  });

  it("never promotes ineligible observation history into price intelligence", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const excluded = observation({
      amountMinor: 1_000n,
      idempotencyKey: "recorded-fixture",
      observedAt: "2026-07-24T12:00:00.000Z",
      sourceListingId: "eligibility-1",
    });
    excluded.analyticsEligible = false;
    await harness.dataPlane.listings.upsertObservation(excluded);

    await expect(
      new PriceTrendService(harness.dataPlane).getListingTrend("fixture-provider:eligibility-1"),
    ).resolves.toMatchObject({
      series: [],
      state: "analytics_excluded",
      summary: {
        confidence: {
          reasons: ["listing_not_analytics_eligible"],
          score: 0,
        },
      },
    });

    const eligible = observation({
      amountMinor: 20_000n,
      idempotencyKey: "eligible-live",
      observedAt: "2026-07-25T12:00:00.000Z",
      sourceListingId: "eligibility-1",
    });
    await harness.dataPlane.listings.upsertObservation(eligible);

    const trend = await new PriceTrendService(harness.dataPlane).getListingTrend(
      "fixture-provider:eligibility-1",
    );
    expect(trend).toMatchObject({
      series: [
        {
          amountMinor: 20_000,
        },
      ],
      state: "insufficient_data",
      summary: {
        sampleSize: 1,
      },
    });
    expect(trend?.series).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ amountMinor: 1_000 })]),
    );
  });
});
