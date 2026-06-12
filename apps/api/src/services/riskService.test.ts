import type { Listing } from "@closetsearch/shared";
import { describe, expect, it } from "vitest";
import { generateRiskSignal } from "./riskService.js";

const baseListing: Listing = {
  id: "mock:listing-1",
  providerId: "mock",
  providerListingId: "listing-1",
  source: {
    id: "mock",
    name: "Mock Closet",
  },
  sourceUrl: "https://mock.closetsearch.dev/listings/listing-1",
  title: "Archive denim jacket",
  brand: {
    id: "brand:archive-label",
    slug: "archive-label",
    name: "Archive Label",
  },
  imageUrl: "https://images.example.com/jacket.jpg",
  price: {
    amount: 240,
    currency: "USD",
  },
  category: "jackets",
  size: "M",
  condition: "excellent",
  listingType: "buy_now",
  fetchedAt: "2026-05-06T10:00:00.000Z",
};

describe("generateRiskSignal", () => {
  it("returns a low placeholder signal for consistent listings", () => {
    const signal = generateRiskSignal(baseListing);

    expect(signal).toMatchObject({
      listingId: baseListing.id,
      riskLevel: "low",
      source: "placeholder_trust_foundation",
      categories: [],
      disclaimer:
        "This is an estimate based on limited listing signals. It is not an authenticity guarantee.",
    });
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
  });

  it("raises an elevated placeholder signal for very low prices with limited details", () => {
    const signal = generateRiskSignal({
      ...baseListing,
      imageUrl: "",
      price: {
        amount: 72,
        currency: "USD",
      },
      size: undefined,
      condition: undefined,
    });

    expect(signal.riskLevel).toBe("elevated");
    expect(signal.categories).toContain("price_anomaly");
    expect(signal.explanation).toContain("higher placeholder review signal");
  });
});
