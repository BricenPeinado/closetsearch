import { randomUUID } from "node:crypto";
import type { PersistWatchlistInput, UpdateWatchlistInput, Watchlist } from "@closetsearch/shared";
import { getDatabase } from "../database.js";

interface WatchlistRow {
  id: string;
  user_id: string;
  label: string;
  query_text?: string | null;
  brand?: string | null;
  category?: string | null;
  source_filter?: string | null;
  listing_type?: string | null;
  min_price_amount?: number | null;
  max_price_amount?: number | null;
  price_currency?: string | null;
  condition?: string | null;
  size?: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function toTrimmedString(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : undefined;
}

function toOptionalCondition(value: string | null | undefined): Watchlist["condition"] {
  switch (value) {
    case "new_with_tags":
    case "new_without_tags":
    case "excellent":
    case "good":
    case "fair":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

function mapWatchlistRow(row: WatchlistRow): Watchlist {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    queryText: toTrimmedString(row.query_text) || undefined,
    brand: toTrimmedString(row.brand) || undefined,
    category: toTrimmedString(row.category) || undefined,
    source: toTrimmedString(row.source_filter) || undefined,
    listingType:
      row.listing_type === "auction" || row.listing_type === "buy_now"
        ? row.listing_type
        : undefined,
    minPriceAmount: typeof row.min_price_amount === "number" ? row.min_price_amount : undefined,
    maxPriceAmount: typeof row.max_price_amount === "number" ? row.max_price_amount : undefined,
    priceCurrency: toTrimmedString(row.price_currency) || undefined,
    condition: toOptionalCondition(row.condition),
    size: toTrimmedString(row.size) || undefined,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function selectWatchlistById(userId: string, id: string) {
  return getDatabase()
    .prepare(
      `SELECT
        id,
        user_id,
        label,
        query_text,
        brand,
        category,
        source_filter,
        listing_type,
        min_price_amount,
        max_price_amount,
        price_currency,
        condition,
        size,
        enabled,
        created_at,
        updated_at
      FROM watchlists
      WHERE user_id = ? AND id = ?`,
    )
    .get(userId, id) as WatchlistRow | undefined;
}

export function listWatchlistsByUserId(userId: string) {
  return (
    getDatabase()
      .prepare(
        `SELECT
        id,
        user_id,
        label,
        query_text,
        brand,
        category,
        source_filter,
        listing_type,
        min_price_amount,
        max_price_amount,
        price_currency,
        condition,
        size,
        enabled,
        created_at,
        updated_at
      FROM watchlists
      WHERE user_id = ?
      ORDER BY updated_at DESC, created_at DESC, id DESC`,
      )
      .all(userId) as unknown as WatchlistRow[]
  ).map(mapWatchlistRow);
}

export function findWatchlistByUserIdAndId(userId: string, id: string) {
  const row = selectWatchlistById(userId, id);
  return row ? mapWatchlistRow(row) : undefined;
}

export function insertWatchlist(input: PersistWatchlistInput) {
  const now = new Date().toISOString();
  const id = randomUUID();

  getDatabase()
    .prepare(
      `INSERT INTO watchlists (
        id,
        user_id,
        label,
        query_text,
        brand,
        category,
        source_filter,
        listing_type,
        min_price_amount,
        max_price_amount,
        max_price,
        price_currency,
        condition,
        size,
        enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId,
      input.label?.trim() ?? "",
      toTrimmedString(input.queryText) || null,
      toTrimmedString(input.brand) || null,
      toTrimmedString(input.category) || null,
      toTrimmedString(input.source) || null,
      input.listingType ?? null,
      normalizeOptionalNumber(input.minPriceAmount) ?? null,
      normalizeOptionalNumber(input.maxPriceAmount) ?? null,
      normalizeOptionalNumber(input.maxPriceAmount) ?? null,
      toTrimmedString(input.priceCurrency).toUpperCase() || null,
      toTrimmedString(input.condition) || null,
      toTrimmedString(input.size) || null,
      input.enabled === false ? 0 : 1,
      now,
      now,
    );

  return selectWatchlistById(input.userId, id) as WatchlistRow;
}

export function updateWatchlist(input: UpdateWatchlistInput) {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `UPDATE watchlists
      SET label = ?,
          query_text = ?,
          brand = ?,
          category = ?,
          source_filter = ?,
          listing_type = ?,
          min_price_amount = ?,
          max_price_amount = ?,
          max_price = ?,
          price_currency = ?,
          condition = ?,
          size = ?,
          enabled = ?,
          updated_at = ?
      WHERE user_id = ? AND id = ?`,
    )
    .run(
      input.label?.trim() ?? "",
      toTrimmedString(input.queryText) || null,
      toTrimmedString(input.brand) || null,
      toTrimmedString(input.category) || null,
      toTrimmedString(input.source) || null,
      input.listingType ?? null,
      normalizeOptionalNumber(input.minPriceAmount) ?? null,
      normalizeOptionalNumber(input.maxPriceAmount) ?? null,
      normalizeOptionalNumber(input.maxPriceAmount) ?? null,
      toTrimmedString(input.priceCurrency).toUpperCase() || null,
      toTrimmedString(input.condition) || null,
      toTrimmedString(input.size) || null,
      input.enabled === false ? 0 : 1,
      now,
      input.userId,
      input.id,
    );

  return selectWatchlistById(input.userId, input.id) as WatchlistRow | undefined;
}

export function deleteWatchlist(userId: string, id: string) {
  const result = getDatabase()
    .prepare("DELETE FROM watchlists WHERE user_id = ? AND id = ?")
    .run(userId, id);

  return result.changes > 0;
}

export function clearWatchlists() {
  getDatabase().prepare("DELETE FROM watchlists").run();
}

export function mapWatchlistResult(row: WatchlistRow) {
  return mapWatchlistRow(row);
}
