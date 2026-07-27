import type { FeedRecommendationMetadata, Listing } from "@closetsearch/shared";
import { describe, expect, it } from "vitest";
import { recommendationReasonForListing } from "./recommendation-ui";

const listing = {
  id: "mock:1",
  brand: { id: "brand:kapital", name: "Kapital", slug: "kapital" },
} as Listing;

function metadata(reasonCodes: string[]): FeedRecommendationMetadata {
  return {
    rankedItems: [{ listingId: listing.id, rank: 1, reasonCodes }],
    rolloutMode: "active",
    strategy: "ml_hybrid",
    usedModel: true,
  };
}

describe("recommendation reasons", () => {
  it("turns internal affinity codes into safe user-facing copy", () => {
    expect(
      recommendationReasonForListing(metadata(["brand_affinity:model-weight=0.82"]), listing, true),
    ).toBe("Because you liked similar Kapital pieces");
  });

  it("does not expose unknown model codes", () => {
    const reason = recommendationReasonForListing(
      metadata(["internal_embedding_cluster_9381"]),
      listing,
      true,
    );

    expect(reason).toBe("Recommended from your interests in Kapital");
    expect(reason).not.toContain("embedding");
    expect(reason).not.toContain("9381");
  });
});
