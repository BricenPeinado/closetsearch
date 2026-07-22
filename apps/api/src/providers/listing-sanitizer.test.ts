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
});
