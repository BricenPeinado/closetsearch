import type { Listing } from "@closetsearch/shared";

const impressionCountsByListingId = new Map<string, number>();

export function recordListingImpressions(listings: Listing[]) {
  for (const listing of listings) {
    impressionCountsByListingId.set(
      listing.id,
      (impressionCountsByListingId.get(listing.id) ?? 0) + 1,
    );
  }
}

export function getListingImpressionCount(listingId: string) {
  return impressionCountsByListingId.get(listingId) ?? 0;
}

export function resetEngagementStore() {
  impressionCountsByListingId.clear();
}
