import { describe, expect, it } from "vitest";
import { createGrailedListingInputFromParsedCard, normalizeGrailedListing } from "./normalizer";

describe("normalizeGrailedListing", () => {
  it("maps parsed Grailed fields into the shared Listing model", () => {
    const listing = normalizeGrailedListing(
      createGrailedListingInputFromParsedCard(
        {
          sourceListingId: "grailed-raw-123",
          sourceUrl: "/listings/grailed-raw-123-visvim-patchwork-shirt",
          title: "Visvim patchwork shirt",
          brand: "Visvim",
          imageUrl: "https://example.com/visvim-shirt.jpg",
          priceText: "USD 425",
          category: "tops",
          size: "3",
          condition: "excellent",
          listingType: "buy_now",
        },
        "2026-06-13T12:30:00.000Z",
      ),
    );

    expect(listing).toBeDefined();
    if (!listing) {
      throw new Error("Expected valid Grailed fixture to normalize.");
    }

    expect(listing).toMatchObject({
      id: "grailed:grailed-raw-123",
      providerId: "grailed",
      providerListingId: "grailed-raw-123",
      source: { id: "grailed", name: "Grailed" },
      sourceUrl: "https://www.grailed.com/listings/grailed-raw-123-visvim-patchwork-shirt",
      title: "Visvim patchwork shirt",
      brand: { id: "brand:visvim", slug: "visvim", name: "Visvim" },
      imageUrl: "https://example.com/visvim-shirt.jpg",
      price: { amount: 425, currency: "USD" },
      category: "tops",
      size: "3",
      condition: "excellent",
      listingType: "buy_now",
      fetchedAt: "2026-06-13T12:30:00.000Z",
    });
  });

  it("drops records whose original price or observation time is malformed", () => {
    const listing = normalizeGrailedListing(
      createGrailedListingInputFromParsedCard(
        {
          sourceUrl: "/listings/grailed-raw-456-vintage-tee",
          title: "Vintage tee",
          brand: undefined,
          imageUrl: undefined,
          priceText: "Offer",
        },
        "not-a-timestamp",
      ),
    );

    expect(listing).toBeUndefined();
  });
});
