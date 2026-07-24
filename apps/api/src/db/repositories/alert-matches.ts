import { randomUUID } from "node:crypto";
import type { AlertMatch, PersistAlertMatchInput } from "@closetsearch/shared";
import { getDatabase } from "../database.js";

interface AlertMatchRow {
  id: string;
  user_id: string;
  watchlist_id: string;
  listing_id: string;
  source: string;
  source_listing_id: string;
  matched_reason_json: string;
  status: string;
  first_matched_at: string;
  last_matched_at: string;
  dismissed_at?: string | null;
}

function toTrimmedString(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function parseReasons(value: string) {
  try {
    const parsedValue = JSON.parse(value) as unknown;

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .filter((reason): reason is { code: string; label: string } => {
        return Boolean(
          reason &&
          typeof reason === "object" &&
          typeof (reason as { code?: unknown }).code === "string" &&
          typeof (reason as { label?: unknown }).label === "string",
        );
      })
      .map((reason) => ({
        code: reason.code,
        label: reason.label,
      }));
  } catch {
    return [];
  }
}

function mapAlertMatchRow(row: AlertMatchRow): AlertMatch {
  return {
    id: row.id,
    userId: row.user_id,
    watchlistId: row.watchlist_id,
    listingId: row.listing_id,
    source: row.source,
    sourceListingId: row.source_listing_id,
    reasons: parseReasons(row.matched_reason_json),
    status: row.status === "dismissed" ? "dismissed" : "candidate",
    firstMatchedAt: row.first_matched_at,
    lastMatchedAt: row.last_matched_at,
    dismissedAt: toTrimmedString(row.dismissed_at) || undefined,
  };
}

function selectAlertMatchByWatchlistAndListing(watchlistId: string, listingId: string) {
  return getDatabase()
    .prepare(
      `SELECT
        id,
        user_id,
        watchlist_id,
        listing_id,
        source,
        source_listing_id,
        matched_reason_json,
        status,
        first_matched_at,
        last_matched_at,
        dismissed_at
      FROM alert_matches
      WHERE watchlist_id = ? AND listing_id = ?`,
    )
    .get(watchlistId, listingId) as AlertMatchRow | undefined;
}

export function listAlertMatchesByUserId(userId: string) {
  return (
    getDatabase()
      .prepare(
        `SELECT
        id,
        user_id,
        watchlist_id,
        listing_id,
        source,
        source_listing_id,
        matched_reason_json,
        status,
        first_matched_at,
        last_matched_at,
        dismissed_at
      FROM alert_matches
      WHERE user_id = ?
      ORDER BY last_matched_at DESC, first_matched_at DESC, id DESC`,
      )
      .all(userId) as unknown as AlertMatchRow[]
  ).map(mapAlertMatchRow);
}

export function upsertAlertMatch(input: PersistAlertMatchInput) {
  const existing = selectAlertMatchByWatchlistAndListing(input.watchlistId, input.listingId);
  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  const firstMatchedAt = existing?.first_matched_at ?? now;

  getDatabase()
    .prepare(
      `INSERT INTO alert_matches (
        id,
        user_id,
        watchlist_id,
        listing_id,
        source,
        source_listing_id,
        matched_reason_json,
        status,
        first_matched_at,
        last_matched_at,
        dismissed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(watchlist_id, listing_id) DO UPDATE SET
        matched_reason_json = excluded.matched_reason_json,
        status = excluded.status,
        source = excluded.source,
        source_listing_id = excluded.source_listing_id,
        last_matched_at = excluded.last_matched_at,
        dismissed_at = excluded.dismissed_at`,
    )
    .run(
      id,
      input.userId,
      input.watchlistId,
      input.listingId,
      input.source,
      input.sourceListingId,
      JSON.stringify(input.reasons),
      input.status ?? "candidate",
      firstMatchedAt,
      now,
      input.dismissedAt ?? null,
    );

  return mapAlertMatchRow(
    selectAlertMatchByWatchlistAndListing(input.watchlistId, input.listingId) as AlertMatchRow,
  );
}

export function clearAlertMatches() {
  getDatabase().prepare("DELETE FROM alert_matches").run();
}
