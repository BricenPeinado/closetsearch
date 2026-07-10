import type { Like } from "@closetsearch/shared";
import { getDatabase } from "../database.js";

interface LikeRow {
  id: string;
  user_id: string;
  listing_id: string;
  source: string;
  created_at: string;
}

function mapLikeRow(row: LikeRow): Like {
  return {
    id: row.id,
    userId: row.user_id,
    listingId: row.listing_id,
    source: row.source,
    createdAt: row.created_at,
  };
}

export function findLikeByUserIdAndListingId(userId: string, listingId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, user_id, listing_id, source, created_at
      FROM likes
      WHERE user_id = ? AND listing_id = ?`,
    )
    .get(userId, listingId) as LikeRow | undefined;

  return row ? mapLikeRow(row) : undefined;
}

export function insertLike(like: Like) {
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO likes (id, user_id, listing_id, source, created_at)
      VALUES (?, ?, ?, ?, ?)`,
    )
    .run(like.id, like.userId, like.listingId, like.source, like.createdAt);

  return findLikeByUserIdAndListingId(like.userId, like.listingId);
}

export function deleteLike(userId: string, listingId: string) {
  const result = getDatabase()
    .prepare("DELETE FROM likes WHERE user_id = ? AND listing_id = ?")
    .run(userId, listingId);

  return result.changes > 0;
}

export function listLikesByUserId(userId: string) {
  return ((getDatabase()
    .prepare(
      `SELECT id, user_id, listing_id, source, created_at
      FROM likes
      WHERE user_id = ?
      ORDER BY created_at DESC`,
    )
    .all(userId) as unknown as LikeRow[])).map(mapLikeRow);
}

export function clearLikes() {
  getDatabase().prepare("DELETE FROM likes").run();
}
