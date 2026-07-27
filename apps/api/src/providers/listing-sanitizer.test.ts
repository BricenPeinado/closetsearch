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
    expect("rawPayload" in (listing as unknown as Record<string, unknown>)).toBe(false);
  });

  it.each([
    ["non-http source URL", { sourceUrl: "javascript:alert(1)" }],
    ["non-http image URL", { imageUrl: "data:text/html,bad" }],
    ["invalid currency", { price: { amount: 100, currency: "US dollars" } }],
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

    expect(sanitizeProviderListing({ ...validListing, ...override })).toBeNull();
  });

  it("preserves Japanese original text, auction facts, and marketplace limitations", () => {
    const listing = sanitizeProviderListing({
      id: "yahoo-auctions-jp:x123",
      providerId: "yahoo-auctions-jp",
      providerListingId: "x123",
      source: {
        id: "yahoo-auctions-jp",
        name: "Yahoo! Auctions Japan",
        dataOrigin: "authorized_scraping",
        isMock: false,
        marketplaceId: "YAHOO_AUCTIONS_JP",
      },
      sourceUrl: "https://page.auctions.yahoo.co.jp/jp/auction/x123",
      title: "<strong>Translated jacket</strong>",
      originalTitle: "コムデギャルソン ジャケット",
      originalDescription: "状態の良いジャケットです",
      originalLanguage: "ja",
      translatedTitle: "Comme des Garçons jacket",
      translatedDescription: "A jacket in good condition",
      brand: {
        id: "brand:comme-des-garcons",
        slug: "comme-des-garcons",
        name: "Comme des Garçons",
      },
      imageUrl: "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/x123.jpg",
      images: [
        {
          url: "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/x123.jpg",
          role: "primary",
          alt: "コムデギャルソン ジャケット",
        },
      ],
      price: {
        amount: 12_500,
        amountMinor: 12_500,
        currency: "JPY",
        fractionDigits: 0,
      },
      pricing: {
        original: {
          amount: 12_500,
          amountMinor: 12_500,
          currency: "JPY",
          fractionDigits: 0,
        },
      },
      listingType: "auction",
      auction: {
        currentBid: {
          amount: 12_500,
          amountMinor: 12_500,
          currency: "JPY",
          fractionDigits: 0,
        },
        bidCount: 7,
        endsAt: "2026-07-28T12:00:00Z",
      },
      fetchedAt: "2026-07-26T12:00:00Z",
      lifecycle: {
        status: "active",
        observedAt: "2026-07-26T12:00:00Z",
        lastSeenAt: "2026-07-26T12:00:00Z",
      },
      market: {
        status: "active",
        isExcludedFromAnalytics: true,
      },
      marketplaceLimitations: {
        closetSearchRole: "discovery_only",
        internationalShipping: "proxy_only",
        proxyPurchaseRequired: true,
        notices: ["Domestic Japan shipping only"],
      },
      attribution: {
        destinationUrl: "https://page.auctions.yahoo.co.jp/jp/auction/x123",
        displayText: "View on Yahoo! Auctions Japan",
        marketplaceName: "Yahoo! Auctions Japan",
        required: true,
      },
    });

    expect(listing).toMatchObject({
      title: "Translated jacket",
      originalTitle: "コムデギャルソン ジャケット",
      originalLanguage: "ja",
      auction: {
        bidCount: 7,
        currentBid: { amountMinor: 12_500, currency: "JPY" },
      },
      marketplaceLimitations: {
        closetSearchRole: "discovery_only",
        proxyPurchaseRequired: true,
      },
    });
  });

  it.each([
    [
      "a provider/source identity mismatch",
      {
        source: {
          id: "mercari-jp",
          name: "Yahoo! Auctions Japan",
          dataOrigin: "authorized_scraping",
        },
      },
    ],
    ["an unreviewed destination host", { sourceUrl: "https://example.com/jp/auction/x123" }],
    ["auction metadata on a fixed-price listing", { listingType: "buy_now" }],
  ])("rejects %s at the provider boundary", (_label, override) => {
    const validAuction = {
      id: "yahoo-auctions-jp:x123",
      providerId: "yahoo-auctions-jp",
      providerListingId: "x123",
      source: {
        id: "yahoo-auctions-jp",
        name: "Yahoo! Auctions Japan",
        dataOrigin: "authorized_scraping",
      },
      sourceUrl: "https://page.auctions.yahoo.co.jp/jp/auction/x123",
      title: "Jacket",
      originalTitle: "ジャケット",
      originalLanguage: "ja",
      brand: { id: "brand:test", slug: "test", name: "Test" },
      imageUrl: "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/x123.jpg",
      price: { amount: 1000, amountMinor: 1000, currency: "JPY", fractionDigits: 0 },
      listingType: "auction",
      auction: {
        currentBid: {
          amount: 1000,
          amountMinor: 1000,
          currency: "JPY",
          fractionDigits: 0,
        },
      },
      fetchedAt: "2026-07-26T12:00:00Z",
      lifecycle: { status: "active", observedAt: "2026-07-26T12:00:00Z" },
      marketplaceLimitations: {
        closetSearchRole: "discovery_only",
        internationalShipping: "unknown",
      },
    };

    expect(sanitizeProviderListing({ ...validAuction, ...override })).toBeNull();
  });

  it.each([
    ["depop", "https://www.depop.com/products/item-1", "https://media.depop.com/item-1.jpg", {}],
    ["ebay", "https://www.ebay.com/itm/item-1", "https://i.ebayimg.com/item-1.jpg", {}],
    [
      "grailed",
      "https://www.grailed.com/listings/item-1",
      "https://cdn.grailed.com/item-1.jpg",
      {},
    ],
    [
      "mercari-jp",
      "https://jp.mercari.com/item/item-1",
      "https://static.mercdn.net/item/detail/orig/item-1.jpg",
      {
        marketplaceLimitations: {
          closetSearchRole: "discovery_only",
          internationalShipping: "unknown",
        },
        originalLanguage: "ja",
        originalTitle: "ジャケット",
      },
    ],
    [
      "yahoo-auctions-jp",
      "https://page.auctions.yahoo.co.jp/jp/auction/item-1",
      "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/item-1.jpg",
      {
        marketplaceLimitations: {
          closetSearchRole: "discovery_only",
          internationalShipping: "unknown",
        },
        originalLanguage: "ja",
        originalTitle: "ジャケット",
      },
    ],
  ])(
    "rejects a cross-origin seller profile for %s",
    (providerId, sourceUrl, imageUrl, providerFields) => {
      expect(
        sanitizeProviderListing({
          id: `${providerId}:item-1`,
          providerId,
          providerListingId: "item-1",
          source: { id: providerId, name: providerId },
          sourceUrl,
          title: "Jacket",
          brand: { id: "brand:test", slug: "test", name: "Test" },
          imageUrl,
          price: { amount: 100, currency: "USD" },
          listingType: "buy_now",
          fetchedAt: "2026-07-26T12:00:00Z",
          seller: {
            username: "seller",
            profileUrl: "https://attacker.example/profile/seller",
          },
          ...providerFields,
        }),
      ).toBeNull();
    },
  );
});
