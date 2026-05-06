import type { Listing } from "@closetsearch/shared";

const listingsById = new Map<string, Listing>();

export function rememberListings(listings: Listing[]) {
  for (const listing of listings) {
    listingsById.set(listing.id, listing);
  }
}

export function getRememberedListing(listingId: string) {
  return listingsById.get(listingId);
}

export function resetListingCatalog() {
  listingsById.clear();
}
