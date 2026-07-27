import type { Listing } from "@closetsearch/shared";
import { describe, expect, it } from "vitest";
import { normalizeListingContext, normalizeListingDetailPayload } from "./listing-detail-data";

const japaneseAuction = {
  id: "yahoo-auctions-jp:abc",
  providerId: "yahoo-auctions-jp",
  providerListingId: "abc",
  source: {
    id: "yahoo-auctions-jp",
    marketplaceId: "yahoo-auctions-jp",
    name: "Yahoo! Auctions Japan",
  },
  sourceUrl: "https://example.jp/auction/abc",
  title: "コムデギャルソン ジャケット",
  brand: { id: "brand:cdg", name: "Comme des Garçons", slug: "comme-des-garcons" },
  price: { amount: 24_800, amountMinor: 24_800, currency: "JPY", fractionDigits: 0 },
  listingType: "auction",
  fetchedAt: "2026-07-26T12:00:00.000Z",
  auction: {
    bidCount: 12,
    buyNowPrice: { amount: 32_000, amountMinor: 32_000, currency: "JPY", fractionDigits: 0 },
    endsAt: "2026-07-27T12:00:00.000Z",
  },
  marketplaceLimitations: {
    internationalShipping: "proxy_only",
    notices: ["Domestic Japanese delivery only.", "Proxy fees are not included."],
    proxyPurchaseRequired: true,
  },
  originalLanguage: "ja",
  originalTitle: "コムデギャルソン ジャケット",
  translatedTitle: "Comme des Garçons jacket",
} as Listing;

describe("listing detail normalization", () => {
  it("keeps Japanese auction and proxy limitations without inventing values", () => {
    const normalized = normalizeListingContext(japaneseAuction);

    expect(normalized.auction).toMatchObject({
      bidCount: 12,
      endsAt: "2026-07-27T12:00:00.000Z",
    });
    expect(normalized.proxyBuyingRequired).toBe(true);
    expect(normalized.internationalShippingAvailable).toBe(false);
    expect(normalized.proxyBuyingNote).toContain("Domestic Japanese delivery only.");
    expect(normalized.originalLanguage).toBe("ja");
  });

  it("rejects incomplete detail payloads", () => {
    expect(normalizeListingDetailPayload({ listing: { id: "broken" } })).toBeUndefined();
  });
});
