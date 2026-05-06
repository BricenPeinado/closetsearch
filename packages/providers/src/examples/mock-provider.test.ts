import { describe, expect, it } from "vitest";
import { mockProvider, normalizeMockListing } from "./mock-provider";

describe("normalizeMockListing", () => {
  it("maps raw provider fields into the shared Listing model", () => {
    const listing = normalizeMockListing({
      id: "raw-123",
      headline: "Kapital fleece jacket",
      designer: "Kapital",
      designerSlug: "kapital",
      imageHref: "https://example.com/jacket.jpg",
      listingHref: "https://example.com/listings/raw-123",
      amount: 320,
      currencyCode: "USD",
      department: "jackets",
      taggedSize: "L",
      wear: "excellent",
      purchaseFormat: "buy_now",
      indexedAt: "2026-05-04T11:00:00.000Z",
    });

    expect(listing).toEqual({
      id: "mock:raw-123",
      providerId: "mock",
      providerListingId: "raw-123",
      source: {
        id: "mock",
        name: "Mock Closet",
      },
      sourceUrl: "https://example.com/listings/raw-123",
      title: "Kapital fleece jacket",
      brand: {
        id: "brand:kapital",
        slug: "kapital",
        name: "Kapital",
      },
      imageUrl: "https://example.com/jacket.jpg",
      price: {
        amount: 320,
        currency: "USD",
      },
      category: "jackets",
      size: "L",
      condition: "excellent",
      listingType: "buy_now",
      fetchedAt: "2026-05-04T11:00:00.000Z",
    });
  });
});

describe("mockProvider", () => {
  it("returns normalized jacket listings for a text query", async () => {
    const response = await mockProvider.search({
      text: "jacket",
    });

    expect(response.status).toBe("success");

    if (response.status !== "success") {
      throw new Error("Expected success response from mock provider");
    }

    expect(response.listings.length).toBeGreaterThan(0);
    expect(response.listings.every((listing) => listing.title.toLowerCase().includes("jacket"))).toBe(
      true,
    );
    expect(response.listings[0]).toMatchObject({
      providerId: "mock",
      source: {
        id: "mock",
        name: "Mock Closet",
      },
    });
  });

  it("supports listing type and price sorting through the normalized search query", async () => {
    const response = await mockProvider.search({
      text: "jacket",
      listingTypes: ["buy_now"],
      sort: "price_asc",
    });

    expect(response.status).toBe("success");

    if (response.status !== "success") {
      throw new Error("Expected success response from mock provider");
    }

    expect(response.listings).toHaveLength(2);
    expect(response.listings.every((listing) => listing.listingType === "buy_now")).toBe(true);
    expect(response.listings[0]?.price.amount).toBeLessThanOrEqual(
      response.listings[1]?.price.amount ?? 0,
    );
  });
});
