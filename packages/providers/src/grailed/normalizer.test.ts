import { describe, expect, it } from "vitest";
import {
  createGrailedListingInputFromParsedCard,
  normalizeGrailedListing,
} from "./normalizer";

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

    expect(listing).toEqual({
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

  it("handles missing brand, image, size, condition, and malformed price safely", () => {
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

    expect(listing.providerId).toBe("grailed");
    expect(listing.brand).toEqual({
      id: "brand:unknown-brand",
      slug: "unknown-brand",
      name: "Unknown Brand",
    });
    expect(listing.imageUrl).toBe("https://closetsearch.dev/placeholders/grailed-listing.png");
    expect(listing.price).toEqual({ amount: 0, currency: "USD" });
    expect(listing.size).toBeUndefined();
    expect(listing.condition).toBeUndefined();
    expect(listing.listingType).toBe("unknown");
    expect(Number.isNaN(new Date(listing.fetchedAt).valueOf())).toBe(false);
  });
});
