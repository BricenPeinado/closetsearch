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
  it("renders the subtle risk estimate and disclaimer when risk info exists", () => {
    const html = renderToString(<ListingCard listing={listing} />);

    expect(html).toContain("Medium review signal");
    expect(html).toContain("Listing signal estimate");
    expect(html).toContain(
      "This is an estimate based on limited listing signals. It is not an authenticity guarantee.",
    );
  });
});
