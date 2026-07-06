import type {
  DeleteSavedSearchInput,
  PersistSearchHistoryInput,
  RecentSearch,
  SavedSearch,
} from "@closetsearch/shared";
import { randomUUID } from "node:crypto";
import { getDatabase } from "../database.js";

type SearchTableName = "recent_searches" | "saved_searches";
type SearchRecord = RecentSearch | SavedSearch;

interface SearchRow {
  id: string;
  user_id: string;
  label: string;
  description: string;
  params: string;
  created_at: string;
}

function mapSearchRow(row: SearchRow): SearchRecord {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    description: row.description,
    params: row.params,
    createdAt: row.created_at,
  };
}

function listSearches(tableName: SearchTableName, userId: string) {
  return ((getDatabase()
    .prepare(
      `SELECT id, user_id, label, description, params, created_at
      FROM ${tableName}
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC`,
    )
    .all(userId) as unknown as SearchRow[])).map(mapSearchRow);
}

function upsertSearch(tableName: SearchTableName, input: PersistSearchHistoryInput) {
  const createdAt = new Date().toISOString();

  getDatabase()
    .prepare(
      `INSERT INTO ${tableName} (id, user_id, label, description, params, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, params) DO UPDATE SET
        label = excluded.label,
        description = excluded.description,
        created_at = excluded.created_at`,
    )
    .run(randomUUID(), input.userId, input.label, input.description, input.params, createdAt);

  const row = getDatabase()
    .prepare(
      `SELECT id, user_id, label, description, params, created_at
      FROM ${tableName}
      WHERE user_id = ? AND params = ?`,
    )
    .get(input.userId, input.params) as unknown as SearchRow;

  return mapSearchRow(row);
}

function clearSearches(tableName: SearchTableName, userId?: string) {
  if (userId) {
    getDatabase().prepare(`DELETE FROM ${tableName} WHERE user_id = ?`).run(userId);
    return;
  }

  getDatabase().prepare(`DELETE FROM ${tableName}`).run();
}

export function listRecentSearchesByUserId(userId: string) {
  return listSearches("recent_searches", userId) as RecentSearch[];
}

export function saveRecentSearch(input: PersistSearchHistoryInput) {
  const savedSearch = upsertSearch("recent_searches", input) as RecentSearch;

  getDatabase()
    .prepare(
      `DELETE FROM recent_searches
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id FROM recent_searches
          WHERE user_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 8
        )`,
    )
    .run(input.userId, input.userId);

  return savedSearch;
}

export function clearRecentSearches(userId?: string) {
  clearSearches("recent_searches", userId);
}

export function listSavedSearchesByUserId(userId: string) {
  return listSearches("saved_searches", userId) as SavedSearch[];
}

export function saveSavedSearch(input: PersistSearchHistoryInput) {
  return upsertSearch("saved_searches", input) as SavedSearch;
}

export function deleteSavedSearch(input: DeleteSavedSearchInput) {
  const result = input.id
    ? getDatabase()
        .prepare("DELETE FROM saved_searches WHERE user_id = ? AND id = ?")
        .run(input.userId, input.id)
    : getDatabase()
        .prepare("DELETE FROM saved_searches WHERE user_id = ? AND params = ?")
        .run(input.userId, input.params ?? "");

  return result.changes > 0;
}

export function clearSavedSearches(userId?: string) {
  clearSearches("saved_searches", userId);
}
