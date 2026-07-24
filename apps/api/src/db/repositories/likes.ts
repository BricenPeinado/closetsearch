import type { Like, Listing } from "@closetsearch/shared";
import { getDatabase } from "../database.js";

interface LikeRow {
  id: string;
  user_id: string;
  listing_id: string;
  source: string;
  created_at: string;
  listing_snapshot_json?: string | null;
}

export interface StoredLikeRecord {
  like: Like;
  listingSnapshot?: Listing;
}

function parseListingSnapshot(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as Listing;
  } catch {
    return undefined;
  }
}

function mapLikeRow(row: LikeRow): StoredLikeRecord {
  return {
    like: {
      id: row.id,
      userId: row.user_id,
      listingId: row.listing_id,
      source: row.source,
      createdAt: row.created_at,
    },
    listingSnapshot: parseListingSnapshot(row.listing_snapshot_json),
  };
}

function getLikeRowByUserIdAndListingId(userId: string, listingId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, user_id, listing_id, source, created_at, listing_snapshot_json
      FROM likes
      WHERE user_id = ? AND listing_id = ?`,
    )
    .get(userId, listingId) as LikeRow | undefined;
}

function getLikeRowByUserIdAndId(userId: string, id: string) {
  return getDatabase()
    .prepare(
      `SELECT id, user_id, listing_id, source, created_at, listing_snapshot_json
      FROM likes
      WHERE user_id = ? AND id = ?`,
    )
    .get(userId, id) as LikeRow | undefined;
}

export function findLikeByUserIdAndListingId(userId: string, listingId: string) {
  const row = getLikeRowByUserIdAndListingId(userId, listingId);
  return row ? mapLikeRow(row) : undefined;
}

export function findLikeByUserIdAndId(userId: string, id: string) {
  const row = getLikeRowByUserIdAndId(userId, id);
  return row ? mapLikeRow(row) : undefined;
}

export function insertLike(input: { like: Like; listingSnapshot?: Listing }) {
  getDatabase()
    .prepare(
      `INSERT INTO likes (
        id,
        user_id,
        listing_id,
        source,
        created_at,
        listing_snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, listing_id) DO UPDATE SET
        source = excluded.source,
        listing_snapshot_json = COALESCE(excluded.listing_snapshot_json, likes.listing_snapshot_json)`,
    )
    .run(
      input.like.id,
      input.like.userId,
      input.like.listingId,
      input.like.source,
      input.like.createdAt,
      input.listingSnapshot ? JSON.stringify(input.listingSnapshot) : null,
    );

  return findLikeByUserIdAndListingId(input.like.userId, input.like.listingId);
}

export function deleteLikeByListingId(userId: string, listingId: string) {
  const result = getDatabase()
    .prepare("DELETE FROM likes WHERE user_id = ? AND listing_id = ?")
    .run(userId, listingId);

  return result.changes > 0;
}

export function deleteLikeById(userId: string, id: string) {
  const result = getDatabase()
    .prepare("DELETE FROM likes WHERE user_id = ? AND id = ?")
    .run(userId, id);

  return result.changes > 0;
}

export function listLikesByUserId(userId: string) {
  return (
    getDatabase()
      .prepare(
        `SELECT id, user_id, listing_id, source, created_at, listing_snapshot_json
      FROM likes
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC`,
      )
      .all(userId) as unknown as LikeRow[]
  ).map(mapLikeRow);
}

export function clearLikes() {
  getDatabase().prepare("DELETE FROM likes").run();
}
