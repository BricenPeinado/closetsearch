import type { Listing } from "@closetsearch/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import { toListingObservation } from "../worker/provider-source.js";
import { ListingDetailService } from "./listingDetailService.js";

function japaneseAuction(): Listing {
  return {
    analyticsEligibility: {
      eligible: true,
    },
    auction: {
      bidCount: 12,
      buyNowPrice: {
        amount: 32_000,
        amountMinor: 32_000,
        currency: "JPY",
        fractionDigits: 0,
      },
      currentBid: {
        amount: 24_800,
        amountMinor: 24_800,
        currency: "JPY",
        fractionDigits: 0,
      },
      endsAt: "2026-07-27T12:00:00.000Z",
    },
    brand: {
      id: "brand:comme-des-garcons",
      name: "Comme des Garçons",
      slug: "comme-des-garcons",
    },
    category: "jackets",
    color: "black",
    condition: "good",
    description: "Comme des Garçons wool jacket.",
    fetchedAt: "2026-07-26T12:00:00.000Z",
    id: "yahoo-auctions-jp:auction-abc",
    imageUrl: "https://images.example.jp/auction-abc.jpg",
    images: [
      {
        alt: "コムデギャルソン ジャケット",
        role: "primary",
        url: "https://images.example.jp/auction-abc.jpg",
      },
    ],
    lifecycle: {
      observedAt: "2026-07-26T12:00:00.000Z",
      status: "active",
    },
    listingType: "auction",
    market: {
      askingPrice: {
        amount: 24_800,
        amountMinor: 24_800,
        currency: "JPY",
      },
      status: "active",
    },
    marketplaceLimitations: {
      closetSearchRole: "discovery_only",
      internationalShipping: "proxy_only",
      notices: ["Domestic Japanese delivery only.", "Proxy fees are not included."],
      proxyPurchaseRequired: true,
    },
    material: "wool",
    originalDescription: "コムデギャルソンのウールジャケットです。",
    originalLanguage: "ja",
    originalTitle: "コムデギャルソン ウール ジャケット",
    price: {
      amount: 24_800,
      amountMinor: 24_800,
      currency: "JPY",
      fractionDigits: 0,
    },
    pricing: {
      comparison: {
        amount: 162,
        amountMinor: 16_200,
        currency: "USD",
        exchangeRate: "0.00653225806452",
        exchangeRateSource: "fixture-fx",
        exchangeRateTimestamp: "2026-07-26T11:55:00.000Z",
        fractionDigits: 2,
        sourceAmountMinor: 24_800,
        sourceCurrency: "JPY",
      },
      original: {
        amount: 24_800,
        amountMinor: 24_800,
        currency: "JPY",
        fractionDigits: 0,
      },
      shipping: {
        amount: 800,
        amountMinor: 800,
        currency: "JPY",
        fractionDigits: 0,
      },
    },
    providerId: "yahoo-auctions-jp",
    providerListingId: "auction-abc",
    seller: {
      feedbackCount: 42,
      location: {
        city: "Tokyo",
        country: "JP",
      },
      username: "expected-seller",
      privateNote: "must-not-leak",
    } as Listing["seller"],
    shipping: {
      available: true,
      cost: {
        amount: 800,
        amountMinor: 800,
        currency: "JPY",
        fractionDigits: 0,
      },
      destinationCountry: "JP",
      originCountry: "JP",
      payer: "buyer",
      type: "domestic",
    },
    source: {
      dataOrigin: "official_api",
      id: "yahoo-auctions-jp",
      marketplaceId: "yahoo-auctions-jp",
      name: "Yahoo! Auctions Japan",
    },
    sourceUrl: "https://auctions.yahoo.co.jp/jp/auction/auction-abc",
    title: "Comme des Garçons wool jacket",
    translatedDescription: "Comme des Garçons wool jacket.",
    translatedTitle: "Comme des Garçons wool jacket",
  };
}

describe("ListingDetailService", () => {
  const harnesses: Array<Awaited<ReturnType<typeof createPostgresTestHarness>>> = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.database.close()));
  });

  it("preserves Japanese source text and limitations through ingestion without leaking raw metadata", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const sourceListing = japaneseAuction();
    const observation = toListingObservation(sourceListing, "active");

    expect(observation).toMatchObject({
      marketplaceLimitations: {
        closetSearchRole: "discovery_only",
        internationalShipping: "proxy_only",
        proxyPurchaseRequired: true,
      },
      originalLanguage: "ja",
      originalTitle: "コムデギャルソン ウール ジャケット",
      translatedTitle: "Comme des Garçons wool jacket",
    });

    await harness.dataPlane.listings.upsertObservation(observation);
    const detail = await new ListingDetailService(
      harness.dataPlane,
      () => new Date("2026-07-26T12:30:00.000Z"),
    ).getListing("yahoo-auctions-jp:auction-abc");

    expect(detail).toMatchObject({
      auction: {
        bidCount: 12,
        currentBid: {
          amountMinor: 24_800,
          currency: "JPY",
          fractionDigits: 0,
        },
        endsAt: "2026-07-27T12:00:00.000Z",
      },
      marketplaceLimitations: {
        closetSearchRole: "discovery_only",
        internationalShipping: "proxy_only",
        notices: ["Domestic Japanese delivery only.", "Proxy fees are not included."],
        proxyPurchaseRequired: true,
      },
      originalDescription: "コムデギャルソンのウールジャケットです。",
      originalLanguage: "ja",
      originalTitle: "コムデギャルソン ウール ジャケット",
      translatedDescription: "Comme des Garçons wool jacket.",
      translatedTitle: "Comme des Garçons wool jacket",
      pricing: {
        display: {
          amountMinor: 16_200,
          currency: "USD",
          exchangeRateSource: "fixture-fx",
          exchangeRateTimestamp: "2026-07-26T11:55:00.000Z",
          sourceAmountMinor: 24_800,
          sourceCurrency: "JPY",
        },
        shipping: {
          amountMinor: 800,
          currency: "JPY",
        },
      },
      seller: {
        feedbackCount: 42,
        location: {
          city: "Tokyo",
          country: "JP",
        },
        username: "expected-seller",
      },
      shipping: {
        available: true,
        cost: {
          amountMinor: 800,
          currency: "JPY",
        },
        destinationCountry: "JP",
        originCountry: "JP",
        payer: "buyer",
        type: "domestic",
      },
    });
    expect(detail?.market?.soldPrice).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain("must-not-leak");
  });
});
