import { describe, expect, it } from "vitest";
import { sanitizeProviderListing } from "./listing-sanitizer.js";

describe("sanitizeProviderListing", () => {
  it("returns null for malformed provider listings instead of throwing", () => {
    expect(
      sanitizeProviderListing({
        id: "bad-listing",
        providerId: "mock",
        providerListingId: "bad-listing",
        source: {
          id: "mock",
        },
      }),
    ).toBeNull();
  });

  it("preserves normalized seller, market, exact-money, freshness, and attribution fields", () => {
    const listing = sanitizeProviderListing({
      id: "ebay:item-1",
      providerId: "ebay",
      providerListingId: "item-1",
      source: {
        id: "ebay",
        name: "eBay",
        dataOrigin: "official_api",
        isMock: false,
        marketplaceId: "EBAY_US",
      },
      sourceUrl: "https://www.ebay.com/itm/item-1",
      title: "Test jacket",
      brand: {
        id: "brand:test",
        slug: "test",
        name: "Test",
      },
      imageUrl: "https://i.ebayimg.com/item-1.jpg",
      images: [
        {
          url: "https://i.ebayimg.com/item-1.jpg",
          role: "primary",
          alt: "Test jacket",
          width: 800,
          height: 800,
        },
      ],
      price: {
        amount: 100,
        amountMinor: 10_000,
        currency: "usd",
        fractionDigits: 2,
      },
      pricing: {
        original: {
          amount: 100,
          amountMinor: 10_000,
          currency: "USD",
          fractionDigits: 2,
        },
        shipping: {
          amount: 5,
          amountMinor: 500,
          currency: "USD",
          fractionDigits: 2,
        },
        landed: {
          amount: 105,
          amountMinor: 10_500,
          currency: "USD",
          fractionDigits: 2,
        },
      },
      condition: "good",
      listingType: "buy_now",
      fetchedAt: "2026-07-24T12:00:00Z",
      seller: {
        username: "seller",
        feedbackCount: 42,
        feedbackPercentage: 99.5,
        trustTier: "established",
        profileUrl: "https://www.ebay.com/usr/seller",
      },
      market: {
        status: "active",
        askingPrice: {
          amount: 100,
          amountMinor: 10_000,
          currency: "USD",
          fractionDigits: 2,
        },
        tags: ["archive"],
        priceDropsCount: 1,
        isExcludedFromAnalytics: false,
      },
      shipping: {
        available: true,
        cost: {
          amount: 5,
          amountMinor: 500,
          currency: "USD",
          fractionDigits: 2,
        },
        isFree: false,
        originCountry: "US",
        minEstimatedDeliveryAt: "2026-07-28T12:00:00Z",
      },
      lifecycle: {
        status: "active",
        observedAt: "2026-07-24T12:00:00Z",
        lastSeenAt: "2026-07-24T12:00:00Z",
        listedAt: "2026-07-20T12:00:00Z",
      },
      freshness: {
        status: "fresh",
        observedAt: "2026-07-24T12:00:00Z",
      },
      attribution: {
        destinationUrl: "https://www.ebay.com/itm/item-1",
        displayText: "View on eBay",
        marketplaceName: "eBay",
        required: true,
        affiliate: false,
      },
      analyticsEligibility: {
        eligible: true,
      },
      rawPayload: {
        secret: "must-not-leak",
      },
    });

    expect(listing).toMatchObject({
      price: {
        amountMinor: 10_000,
        currency: "USD",
      },
      seller: {
        username: "seller",
        feedbackCount: 42,
        feedbackPercentage: 99.5,
      },
      market: {
        status: "active",
        tags: ["archive"],
      },
      lifecycle: {
        status: "active",
        observedAt: "2026-07-24T12:00:00.000Z",
      },
      freshness: {
        status: "fresh",
      },
      attribution: {
        displayText: "View on eBay",
      },
    });
    expect(
      "rawPayload" in (listing as unknown as Record<string, unknown>),
    ).toBe(false);
  });

  it.each([
    ["non-http source URL", { sourceUrl: "javascript:alert(1)" }],
    ["non-http image URL", { imageUrl: "data:text/html,bad" }],
    [
      "invalid currency",
      { price: { amount: 100, currency: "US dollars" } },
    ],
    ["invalid timestamp", { fetchedAt: "not-a-time" }],
  ])("rejects %s", (_label, override) => {
    const validListing = {
      id: "provider:item-1",
      providerId: "provider",
      providerListingId: "item-1",
      source: { id: "provider", name: "Provider" },
      sourceUrl: "https://example.com/item-1",
      title: "Listing",
      brand: {
        id: "brand:test",
        slug: "test",
        name: "Test",
      },
      imageUrl: "https://example.com/item-1.jpg",
      price: { amount: 100, currency: "USD" },
      listingType: "buy_now",
      fetchedAt: "2026-07-24T12:00:00.000Z",
    };

    expect(
      sanitizeProviderListing({ ...validListing, ...override }),
    ).toBeNull();
  });
});
