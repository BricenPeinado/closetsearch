import type { Listing } from "@closetsearch/shared";
import { describe, expect, it } from "vitest";
import { sortListingsForSearch } from "./search-service.js";

function createListing(
  id: string,
  amount: number,
  currency: string,
): Listing {
  return {
    brand: {
      id: "brand:test",
      name: "Test",
      slug: "test",
    },
    fetchedAt: "2026-07-24T12:00:00.000Z",
    id,
    imageUrl: "https://images.example.com/item.jpg",
    listingType: "buy_now",
    price: {
      amount,
      currency,
    },
    providerId: "fixture",
    providerListingId: id,
    source: {
      id: "fixture",
      name: "Fixture",
    },
    sourceUrl: `https://market.example/items/${id}`,
    title: id,
  };
}

describe("search price sorting", () => {
  it("sorts comparable same-currency values deterministically", () => {
    expect(
      sortListingsForSearch(
        [
          createListing("b", 200, "USD"),
          createListing("a", 100, "USD"),
        ],
        "price_asc",
      ).map((listing) => listing.id),
    ).toEqual(["a", "b"]);
  });

  it("does not compare unconverted values from different currencies", () => {
    const listings = [
      createListing("usd", 100, "USD"),
      createListing("jpy", 10_000, "JPY"),
    ];

    expect(
      sortListingsForSearch(listings, "price_asc").map(
        (listing) => listing.id,
      ),
    ).toEqual(["usd", "jpy"]);
  });

  it("uses converted display money when every listing shares the target currency", () => {
    const expensive = createListing("expensive", 100, "USD");
    const cheaper = createListing("cheaper", 20_000, "JPY");
    expensive.pricing = {
      display: {
        amount: 90,
        amountMinor: 9_000,
        currency: "EUR",
        exchangeRate: "0.9",
        exchangeRateSource: "fixture",
        exchangeRateTimestamp: "2026-07-24T12:00:00.000Z",
        sourceAmountMinor: 10_000,
        sourceCurrency: "USD",
      },
      original: expensive.price,
    };
    cheaper.pricing = {
      display: {
        amount: 80,
        amountMinor: 8_000,
        currency: "EUR",
        exchangeRate: "0.004",
        exchangeRateSource: "fixture",
        exchangeRateTimestamp: "2026-07-24T12:00:00.000Z",
        sourceAmountMinor: 20_000,
        sourceCurrency: "JPY",
      },
      original: cheaper.price,
    };

    expect(
      sortListingsForSearch(
        [expensive, cheaper],
        "price_asc",
      ).map((listing) => listing.id),
    ).toEqual(["cheaper", "expensive"]);
  });
});
