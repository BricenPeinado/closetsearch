import type { Listing } from "@closetsearch/shared";
import { randomUUID } from "node:crypto";
import { getDatabase } from "../database.js";

interface ListingCacheRow {
  listing_json: string;
  first_seen_at?: string;
}

function parseListing(value: string) {
  return JSON.parse(value) as Listing;
}

export function upsertListing(listing: Listing) {
  const existingRow = getDatabase()
    .prepare(
      `SELECT listing_json, first_seen_at
      FROM listing_cache
      WHERE source = ? AND source_listing_id = ?`,
    )
    .get(listing.source.id, listing.providerListingId) as ListingCacheRow | undefined;

  const firstSeenAt = existingRow?.first_seen_at ?? listing.fetchedAt;

  getDatabase()
    .prepare(
      `INSERT INTO listing_cache (
        id,
        source,
        source_listing_id,
        listing_json,
        first_seen_at,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_listing_id) DO UPDATE SET
        listing_json = excluded.listing_json,
        last_seen_at = excluded.last_seen_at`,
    )
    .run(
      randomUUID(),
      listing.source.id,
      listing.providerListingId,
      JSON.stringify(listing),
      firstSeenAt,
      listing.fetchedAt,
    );
}

export function findListingBySourceAndProviderListingId(source: string, providerListingId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT listing_json
      FROM listing_cache
      WHERE source = ? AND source_listing_id = ?`,
    )
    .get(source, providerListingId) as ListingCacheRow | undefined;

  return row ? parseListing(row.listing_json) : undefined;
}

export function listCachedListings() {
  return (
    getDatabase()
      .prepare("SELECT listing_json FROM listing_cache")
      .all() as unknown as ListingCacheRow[]
  ).map((row) => parseListing(row.listing_json));
}

export function clearListingCache() {
  getDatabase().prepare("DELETE FROM listing_cache").run();
}
