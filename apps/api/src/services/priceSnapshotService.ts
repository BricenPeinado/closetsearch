import type { Listing } from "@closetsearch/shared";
import {
  clearPriceSnapshots,
  listLatestPriceSnapshots,
  listPriceSnapshots,
  persistPriceSnapshot,
} from "../db/repositories/price-snapshots.js";

function hasUsableObservedPrice(listing: Listing) {
  return Number.isFinite(listing.price.amount) &&
    listing.price.amount > 0 &&
    listing.price.currency.trim().length > 0;
}

function shouldRecordListing(listing: Listing) {
  return (
    listing.source.id.trim().length > 0 &&
    listing.providerListingId.trim().length > 0 &&
    listing.sourceUrl.trim().length > 0 &&
    hasUsableObservedPrice(listing) &&
    (
      listing.market?.isExcludedFromAnalytics === false ||
      listing.market?.isExcludedFromAnalytics === undefined
    )
  );
}

export function recordObservedListings(
  listings: Listing[],
  observedAt = new Date().toISOString(),
) {

  for (const listing of listings) {
    if (shouldRecordListing(listing) === false) {
      continue;
    }

    persistPriceSnapshot({
      listing,
      observedAt,
    });
  }
}

export function getObservedPriceSnapshots() {
  return listPriceSnapshots();
}

export function getLatestObservedPriceSnapshots() {
  return listLatestPriceSnapshots();
}

export function resetPriceSnapshotStore() {
  clearPriceSnapshots();
}
