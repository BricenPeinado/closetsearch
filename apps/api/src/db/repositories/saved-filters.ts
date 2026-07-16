import { randomUUID } from "node:crypto";
import type { PersistSavedFilterInput, SavedFilter } from "@closetsearch/shared";
import { getDatabase } from "../database.js";

interface SavedFilterRow {
  id: string;
  user_id: string;
  label: string;
  query_text?: string | null;
  source_filter?: string | null;
  listing_type_filter?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  sort_mode?: SavedFilter["sortMode"] | null;
  created_at: string;
  updated_at: string;
}

function toTrimmedString(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;
}

function buildSavedFilterParamsKey(input: PersistSavedFilterInput) {
  return JSON.stringify({
    listingType: input.listingType?.trim() || "",
    maxPrice: normalizeOptionalNumber(input.maxPrice) ?? null,
    minPrice: normalizeOptionalNumber(input.minPrice) ?? null,
    queryText: toTrimmedString(input.queryText) || "",
    sortMode: input.sortMode ?? "",
    source: toTrimmedString(input.source) || "",
  });
}

function mapSavedFilterRow(row: SavedFilterRow): SavedFilter {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    queryText: toTrimmedString(row.query_text) || undefined,
    source: toTrimmedString(row.source_filter) || undefined,
    listingType:
      row.listing_type_filter === "auction" || row.listing_type_filter === "buy_now"
        ? row.listing_type_filter
        : undefined,
    minPrice: typeof row.min_price === "number" ? row.min_price : undefined,
    maxPrice: typeof row.max_price === "number" ? row.max_price : undefined,
    sortMode: row.sort_mode ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSavedFiltersByUserId(userId: string) {
  return ((getDatabase()
    .prepare(
      `SELECT
        id,
        user_id,
        label,
        query_text,
        source_filter,
        listing_type_filter,
        min_price,
        max_price,
        sort_mode,
        created_at,
        updated_at
      FROM saved_filters
      WHERE user_id = ?
      ORDER BY updated_at DESC, created_at DESC, id DESC`,
    )
    .all(userId) as unknown as SavedFilterRow[])).map(mapSavedFilterRow);
}

export function saveSavedFilter(input: PersistSavedFilterInput) {
  const now = new Date().toISOString();
  const paramsKey = buildSavedFilterParamsKey(input);

  getDatabase()
    .prepare(
      `INSERT INTO saved_filters (
        id,
        user_id,
        label,
        params_key,
        query_text,
        source_filter,
        listing_type_filter,
        min_price,
        max_price,
        sort_mode,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, params_key) DO UPDATE SET
        label = excluded.label,
        query_text = excluded.query_text,
        source_filter = excluded.source_filter,
        listing_type_filter = excluded.listing_type_filter,
        min_price = excluded.min_price,
        max_price = excluded.max_price,
        sort_mode = excluded.sort_mode,
        updated_at = excluded.updated_at`,
    )
    .run(
      randomUUID(),
      input.userId,
      input.label.trim(),
      paramsKey,
      toTrimmedString(input.queryText) || null,
      toTrimmedString(input.source) || null,
      toTrimmedString(input.listingType) || null,
      normalizeOptionalNumber(input.minPrice) ?? null,
      normalizeOptionalNumber(input.maxPrice) ?? null,
      input.sortMode ?? null,
      now,
      now,
    );

  return getDatabase()
    .prepare(
      `SELECT
        id,
        user_id,
        label,
        query_text,
        source_filter,
        listing_type_filter,
        min_price,
        max_price,
        sort_mode,
        created_at,
        updated_at
      FROM saved_filters
      WHERE user_id = ? AND params_key = ?`,
    )
    .get(input.userId, paramsKey) as unknown as SavedFilterRow;
}

export function deleteSavedFilter(userId: string, id: string) {
  const result = getDatabase()
    .prepare("DELETE FROM saved_filters WHERE user_id = ? AND id = ?")
    .run(userId, id);

  return result.changes > 0;
}

export function clearSavedFilters() {
  getDatabase().prepare("DELETE FROM saved_filters").run();
}

export function mapSavedFilterResult(row: SavedFilterRow) {
  return mapSavedFilterRow(row);
}
