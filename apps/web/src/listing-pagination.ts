import type { Listing } from "@closetsearch/shared";

function createListingClientDedupeKey(listing: Listing) {
  if (listing.providerId && listing.providerListingId) {
    return listing.providerId + ":" + listing.providerListingId;
  }

  if (listing.source.id && listing.sourceUrl) {
    return listing.source.id + ":" + listing.sourceUrl;
  }

  return listing.id;
}

export function mergeUniqueListings(current: Listing[], incoming: Listing[]) {
  const mergedListings = [...current];
  const seenKeys = new Set(current.map(createListingClientDedupeKey));

  for (const listing of incoming) {
    const dedupeKey = createListingClientDedupeKey(listing);

    if (seenKeys.has(dedupeKey)) {
      continue;
    }

    seenKeys.add(dedupeKey);
    mergedListings.push(listing);
  }

  return mergedListings;
}
