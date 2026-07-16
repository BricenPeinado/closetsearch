import { randomUUID } from "node:crypto";
import type { PersistWatchlistInput, Watchlist } from "@closetsearch/shared";
import { getDatabase } from "../database.js";

interface WatchlistRow {
  id: string;
  user_id: string;
  label: string;
  query_text?: string | null;
  brand?: string | null;
  max_price?: number | null;
  source_filter?: string | null;
  created_at: string;
  updated_at: string;
}

function toTrimmedString(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;
}

function mapWatchlistRow(row: WatchlistRow): Watchlist {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    queryText: toTrimmedString(row.query_text) || undefined,
    brand: toTrimmedString(row.brand) || undefined,
    maxPrice: typeof row.max_price === "number" ? row.max_price : undefined,
    source: toTrimmedString(row.source_filter) || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWatchlistsByUserId(userId: string) {
  return ((getDatabase()
    .prepare(
      `SELECT
        id,
        user_id,
        label,
        query_text,
        brand,
        max_price,
        source_filter,
        created_at,
        updated_at
      FROM watchlists
      WHERE user_id = ?
      ORDER BY updated_at DESC, created_at DESC, id DESC`,
    )
    .all(userId) as unknown as WatchlistRow[])).map(mapWatchlistRow);
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
        max_price,
        source_filter,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId,
      input.label.trim(),
      toTrimmedString(input.queryText) || null,
      toTrimmedString(input.brand) || null,
      normalizeOptionalNumber(input.maxPrice) ?? null,
      toTrimmedString(input.source) || null,
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
        brand,
        max_price,
        source_filter,
        created_at,
        updated_at
      FROM watchlists
      WHERE user_id = ? AND id = ?`,
    )
    .get(input.userId, id) as unknown as WatchlistRow;
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
