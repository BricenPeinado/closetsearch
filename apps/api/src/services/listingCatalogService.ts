import type { Listing } from "@closetsearch/shared";
import {
  clearListingCache,
  findListingBySourceAndProviderListingId,
  listCachedListings,
  upsertListing,
} from "../db/repositories/listing-cache.js";

function parseListingLookup(listingId: string) {
  const separatorIndex = listingId.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === listingId.length - 1) {
    return null;
  }

  return {
    source: listingId.slice(0, separatorIndex),
    providerListingId: listingId.slice(separatorIndex + 1),
  };
}

export function rememberListings(listings: Listing[]) {
  for (const listing of listings) {
    upsertListing(listing);
  }
}

export function getRememberedListing(listingId: string) {
  const parsedLookup = parseListingLookup(listingId);

  if (parsedLookup) {
    return findListingBySourceAndProviderListingId(
      parsedLookup.source,
      parsedLookup.providerListingId,
    );
  }

  return listCachedListings().find((listing) => listing.id === listingId);
}

export function resetListingCatalog() {
  clearListingCache();
}
