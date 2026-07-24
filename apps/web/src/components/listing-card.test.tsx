import type { Listing } from "@closetsearch/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListingCard } from "./listing-card";

const listing: Listing = {
  id: "mock:listing-1",
  providerId: "mock",
  providerListingId: "listing-1",
  source: {
    id: "mock",
    name: "Mock Closet",
  },
  sourceUrl: "https://mock.closetsearch.dev/listings/listing-1",
  title: "Archive wool overshirt",
  brand: {
    id: "brand:archive-label",
    slug: "archive-label",
    name: "Archive Label",
  },
  imageUrl: "https://images.example.com/item.jpg",
  price: {
    amount: 180,
    currency: "USD",
  },
  category: "outerwear",
  size: "M",
  condition: "good",
  listingType: "buy_now",
  fetchedAt: "2026-05-06T10:00:00.000Z",
  riskSignal: {
    id: "mock:listing-1:risk",
    listingId: "mock:listing-1",
    source: "placeholder_trust_foundation",
    riskLevel: "medium",
    confidence: 0.41,
    categories: ["price_anomaly"],
    explanation:
      "A few listing details suggest this item may deserve a closer manual review, including price positioning.",
    disclaimer:
      "This is an estimate based on limited listing signals. It is not an authenticity guarantee.",
    createdAt: "2026-05-06T10:00:00.000Z",
  },
};

describe("ListingCard", () => {
  it("hides placeholder risk output unless the experimental flag is enabled", () => {
    const html = renderToString(<ListingCard listing={listing} />);

    expect(html).not.toContain("review signal");
    expect(html).not.toContain("authenticity guarantee");
  });

  it("renders normalized status, seller, marketplace action, and converted price", () => {
    const html = renderToString(
      <ListingCard
        listing={{
          ...listing,
          lifecycle: {
            observedAt: listing.fetchedAt,
            status: "active",
          },
          pricing: {
            original: {
              amount: 180,
              amountMinor: 18_000,
              currency: "USD",
              fractionDigits: 2,
            },
            display: {
              amount: 165,
              amountMinor: 16_500,
              currency: "EUR",
              exchangeRate: "0.91666667",
              exchangeRateSource: "fixture",
              exchangeRateTimestamp: listing.fetchedAt,
              fractionDigits: 2,
              sourceAmountMinor: 18_000,
              sourceCurrency: "USD",
            },
          },
          seller: {
            displayName: "Archive Seller",
          },
        }}
      />,
    );

    expect(html).toContain("€165.00");
    expect(html).toContain("Originally");
    expect(html).toContain("$180.00");
    expect(html).toContain("Seller:");
    expect(html).toContain("Archive Seller");
    expect(html).toContain("View on");
    expect(html).toContain("Mock Closet");
    expect(html).toContain(">active<");
  });
});
