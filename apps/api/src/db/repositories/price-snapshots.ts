import { randomUUID } from "node:crypto";
import type { Listing, PriceSnapshot } from "@closetsearch/shared";
import { getDatabase } from "../database.js";

interface PriceSnapshotRow {
  observation_sequence: number;
  id: string;
  listing_id: string;
  source: string;
  source_listing_id: string;
  brand?: string | null;
  category?: string | null;
  title?: string | null;
  price_amount: number;
  price_currency: string;
  normalized_price_amount: number;
  normalized_price_currency: string;
  condition?: PriceSnapshot["condition"] | null;
  size?: string | null;
  listing_type: PriceSnapshot["listingType"];
  market_status: PriceSnapshot["marketStatus"];
  source_url: string;
  observed_at: string;
  last_seen_at: string;
  listing_json?: string | null;
}

interface PersistPriceSnapshotInput {
  listing: Listing;
  observedAt: string;
}

function normalizeString(value?: string | null) {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : undefined;
}

function normalizeCurrency(value: string) {
  return value.trim().toUpperCase();
}

function parseListing(value?: string | null) {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(value) as Listing;
  } catch {
    return undefined;
  }
}

function mapPriceSnapshotRow(row: PriceSnapshotRow): PriceSnapshot {
  const listing = parseListing(row.listing_json);

  return {
    id: row.id,
    observationSequence: row.observation_sequence,
    listingId: row.listing_id,
    source: row.source,
    sourceListingId: row.source_listing_id,
    brand: normalizeString(row.brand),
    category: normalizeString(row.category),
    title: normalizeString(row.title),
    imageUrl: normalizeString(listing?.imageUrl),
    priceAmount: row.price_amount,
    priceCurrency: normalizeCurrency(row.price_currency),
    normalizedPriceAmount: row.normalized_price_amount,
    normalizedPriceCurrency: normalizeCurrency(row.normalized_price_currency),
    condition: row.condition ?? undefined,
    size: normalizeString(row.size),
    listingType: row.listing_type,
    marketStatus: row.market_status,
    sourceUrl: row.source_url,
    observedAt: row.observed_at,
    lastSeenAt: row.last_seen_at,
  };
}

function getSnapshotRowById(id: string) {
  return getDatabase()
    .prepare(
      `SELECT
        observation_sequence,
        id,
        listing_id,
        source,
        source_listing_id,
        brand,
        category,
        title,
        price_amount,
        price_currency,
        normalized_price_amount,
        normalized_price_currency,
        condition,
        size,
        listing_type,
        market_status,
        source_url,
        observed_at,
        last_seen_at,
        listing_json
      FROM price_snapshots
      WHERE id = ?`,
    )
    .get(id) as PriceSnapshotRow | undefined;
}

function getLatestRow(input: PersistPriceSnapshotInput) {
  return getDatabase()
    .prepare(
      `SELECT
        observation_sequence,
        id,
        listing_id,
        source,
        source_listing_id,
        brand,
        category,
        title,
        price_amount,
        price_currency,
        normalized_price_amount,
        normalized_price_currency,
        condition,
        size,
        listing_type,
        market_status,
        source_url,
        observed_at,
        last_seen_at,
        listing_json
      FROM price_snapshots
      WHERE source = ?
        AND source_listing_id = ?
      ORDER BY observation_sequence DESC
      LIMIT 1`,
    )
    .get(
      input.listing.source.id,
      input.listing.providerListingId,
    ) as PriceSnapshotRow | undefined;
}

export function persistPriceSnapshot(input: PersistPriceSnapshotInput) {
  const normalizedPriceAmount = Math.trunc(input.listing.price.amount);
  const normalizedPriceCurrency = normalizeCurrency(input.listing.price.currency);
  const marketStatus = input.listing.market?.status ?? "active";
  const latestRow = getLatestRow(input);
  const isSameObservedState =
    latestRow !== undefined &&
    latestRow.normalized_price_amount === normalizedPriceAmount &&
    normalizeCurrency(latestRow.normalized_price_currency) ===
      normalizedPriceCurrency &&
    latestRow.market_status === marketStatus;

  if (latestRow && isSameObservedState) {
    getDatabase()
      .prepare(
        `UPDATE price_snapshots
        SET
          listing_id = ?,
          brand = ?,
          category = ?,
          title = ?,
          price_amount = ?,
          price_currency = ?,
          condition = ?,
          size = ?,
          listing_type = ?,
          source_url = ?,
          last_seen_at = ?,
          listing_json = ?
        WHERE id = ?`,
      )
      .run(
        input.listing.id,
        normalizeString(input.listing.brand.name) ?? null,
        normalizeString(input.listing.category) ?? null,
        normalizeString(input.listing.title) ?? null,
        normalizedPriceAmount,
        normalizedPriceCurrency,
        input.listing.condition ?? null,
        normalizeString(input.listing.size) ?? null,
        input.listing.listingType,
        input.listing.sourceUrl,
        input.observedAt,
        JSON.stringify(input.listing),
        latestRow.id,
      );

    return mapPriceSnapshotRow(getSnapshotRowById(latestRow.id) ?? latestRow);
  }

  const id = randomUUID();

  getDatabase()
    .prepare(
      `INSERT INTO price_snapshots (
        id,
        listing_id,
        source,
        source_listing_id,
        brand,
        category,
        title,
        price_amount,
        price_currency,
        normalized_price_amount,
        normalized_price_currency,
        condition,
        size,
        listing_type,
        market_status,
        source_url,
        observed_at,
        last_seen_at,
        listing_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.listing.id,
      input.listing.source.id,
      input.listing.providerListingId,
      normalizeString(input.listing.brand.name) ?? null,
      normalizeString(input.listing.category) ?? null,
      normalizeString(input.listing.title) ?? null,
      normalizedPriceAmount,
      normalizedPriceCurrency,
      normalizedPriceAmount,
      normalizedPriceCurrency,
      input.listing.condition ?? null,
      normalizeString(input.listing.size) ?? null,
      input.listing.listingType,
      marketStatus,
      input.listing.sourceUrl,
      input.observedAt,
      input.observedAt,
      JSON.stringify(input.listing),
    );

  return mapPriceSnapshotRow(getSnapshotRowById(id) as PriceSnapshotRow);
}

export function listPriceSnapshots() {
  return ((getDatabase()
    .prepare(
      `SELECT
        observation_sequence,
        id,
        listing_id,
        source,
        source_listing_id,
        brand,
        category,
        title,
        price_amount,
        price_currency,
        normalized_price_amount,
        normalized_price_currency,
        condition,
        size,
        listing_type,
        market_status,
        source_url,
        observed_at,
        last_seen_at,
        listing_json
      FROM price_snapshots
      ORDER BY observation_sequence DESC`,
    )
    .all() as unknown as PriceSnapshotRow[])).map(mapPriceSnapshotRow);
}

export function listLatestPriceSnapshots() {
  const latestSnapshotsByListing = new Map<string, PriceSnapshot>();

  for (const snapshot of listPriceSnapshots()) {
    const key = `${snapshot.source}:${snapshot.sourceListingId}`;

    if (!latestSnapshotsByListing.has(key)) {
      latestSnapshotsByListing.set(key, snapshot);
    }
  }

  return Array.from(latestSnapshotsByListing.values()).sort(
    (left, right) => right.observationSequence - left.observationSequence,
  );
}

export function clearPriceSnapshots() {
  getDatabase().prepare("DELETE FROM price_snapshots").run();
}
