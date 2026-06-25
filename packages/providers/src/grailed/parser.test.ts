import { describe, expect, it } from "vitest";
import {
  grailedNoResultsHtmlFixture,
  grailedPartialSearchHtmlFixture,
  grailedSearchHtmlFixture,
} from "./fixtures";
import { hasGrailedNoResultsState, parseGrailedListingCards } from "./parser";

describe("parseGrailedListingCards", () => {
  it("parses public Grailed listing-card HTML into a safe intermediate shape", () => {
    const cards = parseGrailedListingCards(grailedSearchHtmlFixture);

    expect(cards).toEqual([
      {
        sourceUrl: "/listings/grailed-1001-kapital-ring-coat",
        sourceListingId: "grailed-1001-kapital-ring-coat",
        title: "Kapital ring coat",
        brand: "Kapital",
        imageUrl: "https://media.example.com/grailed-1001.jpg",
        priceText: "$325",
        size: "L",
        condition: "Good",
        category: "Outerwear",
        listingType: undefined,
      },
      {
        sourceUrl: "/listings/grailed-1002-vintage-band-tee",
        sourceListingId: "grailed-1002-vintage-band-tee",
        title: "Vintage band tee",
        brand: "Vintage",
        imageUrl: "https://media.example.com/grailed-1002.jpg",
        priceText: "US $85",
        size: "M",
        condition: "Excellent",
        category: "Tops",
        listingType: undefined,
      },
    ]);
  });

  it("handles partial listing-card markup without crashing", () => {
    const cards = parseGrailedListingCards(grailedPartialSearchHtmlFixture);

    expect(cards).toEqual([
      {
        sourceUrl: "/listings/grailed-2001-unknown-archive-piece",
        sourceListingId: "grailed-2001-unknown-archive-piece",
        title: "Unknown archive piece",
        brand: undefined,
        imageUrl: undefined,
        priceText: "Offer",
        size: undefined,
        condition: undefined,
        category: undefined,
        listingType: undefined,
      },
    ]);
  });
});

describe("hasGrailedNoResultsState", () => {
  it("detects the public no-results state", () => {
    expect(hasGrailedNoResultsState(grailedNoResultsHtmlFixture)).toBe(true);
    expect(hasGrailedNoResultsState(grailedSearchHtmlFixture)).toBe(false);
  });
});
