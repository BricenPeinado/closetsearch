import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Listing, Watchlist } from "@closetsearch/shared";
import { cleanupIsolatedDatabase, useIsolatedDatabase } from "../db/test-helpers.js";
import { createUser, resetUserStore } from "../user-service.js";
import { createWatchlist, resetWatchlistStore } from "./watchlistService.js";
import {
  evaluateWatchlistMatch,
  getAlertMatchesByUserId,
  resetAlertMatchStore,
  storeAlertMatchCandidate,
} from "./alertMatchService.js";

const listing: Listing = {
  id: "mock:listing-1",
  providerId: "mock",
  providerListingId: "listing-1",
  source: {
    id: "grailed",
    name: "Grailed",
  },
  sourceUrl: "https://example.com/listing-1",
  title: "Rick Owens leather jacket",
  brand: {
    id: "brand:rick-owens",
    slug: "rick-owens",
    name: "Rick Owens",
  },
  imageUrl: "https://example.com/listing-1.jpg",
  price: {
    amount: 280,
    currency: "USD",
  },
  listingType: "buy_now",
  category: "jacket",
  size: "M",
  condition: "excellent",
  fetchedAt: "2026-07-16T12:00:00.000Z",
};

function createEnabledWatchlist(overrides: Partial<Watchlist>): Watchlist {
  return {
    id: "watchlist-1",
    userId: "user-1",
    label: "Test watchlist",
    enabled: true,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
    ...overrides,
  };
}

describe("alertMatchService", () => {
  let databasePath = "";

  beforeEach(() => {
    databasePath = useIsolatedDatabase("alert-match-service");
    resetUserStore();
    resetWatchlistStore();
    resetAlertMatchStore();
  });

  afterEach(() => {
    cleanupIsolatedDatabase(databasePath);
  });

  it("returns explainable reasons when a watchlist matches across key criteria", () => {
    const result = evaluateWatchlistMatch(
      createEnabledWatchlist({
        brand: "Rick Owens",
        category: "jacket",
        condition: "excellent",
        listingType: "buy_now",
        maxPriceAmount: 300,
        minPriceAmount: 200,
        priceCurrency: "USD",
        queryText: "leather jacket",
        size: "M",
        source: "grailed",
      }),
      listing,
    );

    expect(result.matched).toBe(true);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "brand_match" }),
        expect.objectContaining({ code: "query_match" }),
        expect.objectContaining({ code: "category_match" }),
        expect.objectContaining({ code: "source_match" }),
        expect.objectContaining({ code: "listing_type_match" }),
        expect.objectContaining({ code: "price_currency_match" }),
        expect.objectContaining({ code: "price_over_min" }),
        expect.objectContaining({ code: "price_under_max" }),
        expect.objectContaining({ code: "size_match" }),
        expect.objectContaining({ code: "condition_match" }),
      ]),
    );
  });

  it("loosely matches saved search text against listing text", () => {
    const result = evaluateWatchlistMatch(
      createEnabledWatchlist({
        queryText: "rick leather",
      }),
      listing,
    );

    expect(result).toEqual({
      matched: true,
      reasons: [{ code: "query_match", label: "Listing matches watched search" }],
    });
  });

  it("rejects non-matching brand, source, listing type, and price criteria", () => {
    expect(
      evaluateWatchlistMatch(
        createEnabledWatchlist({
          brand: "Kapital",
        }),
        listing,
      ),
    ).toEqual({ matched: false, reasons: [] });

    expect(
      evaluateWatchlistMatch(
        createEnabledWatchlist({
          source: "ebay",
        }),
        listing,
      ),
    ).toEqual({ matched: false, reasons: [] });

    expect(
      evaluateWatchlistMatch(
        createEnabledWatchlist({
          listingType: "auction",
        }),
        listing,
      ),
    ).toEqual({ matched: false, reasons: [] });

    expect(
      evaluateWatchlistMatch(
        createEnabledWatchlist({
          minPriceAmount: 400,
        }),
        listing,
      ),
    ).toEqual({ matched: false, reasons: [] });
  });

  it("does not match disabled watchlists", () => {
    expect(
      evaluateWatchlistMatch(
        createEnabledWatchlist({
          enabled: false,
          brand: "Rick Owens",
        }),
        listing,
      ),
    ).toEqual({ matched: false, reasons: [] });
  });

  it("stores candidate matches once per watchlist and listing", () => {
    const signup = createUser("matchfan", "mohaircoat");
    const watchlist = createWatchlist({
      userId: signup.userId,
      brand: "Rick Owens",
      maxPriceAmount: 300,
      source: "grailed",
    });

    const firstMatch = storeAlertMatchCandidate({
      userId: signup.userId,
      watchlistId: watchlist.id,
      listingId: listing.id,
      source: listing.source.id,
      sourceListingId: listing.providerListingId,
      reasons: [{ code: "brand_match", label: "Brand matches watched brand" }],
    });

    const secondMatch = storeAlertMatchCandidate({
      userId: signup.userId,
      watchlistId: watchlist.id,
      listingId: listing.id,
      source: listing.source.id,
      sourceListingId: listing.providerListingId,
      reasons: [{ code: "price_under_max", label: "Price is under watched maximum" }],
    });

    expect(secondMatch.id).toBe(firstMatch.id);
    expect(getAlertMatchesByUserId(signup.userId)).toHaveLength(1);
    expect(getAlertMatchesByUserId(signup.userId)[0]).toMatchObject({
      listingId: listing.id,
      source: "grailed",
      status: "candidate",
      watchlistId: watchlist.id,
    });
    expect(getAlertMatchesByUserId(signup.userId)[0].reasons).toEqual([
      { code: "price_under_max", label: "Price is under watched maximum" },
    ]);
  });
});
