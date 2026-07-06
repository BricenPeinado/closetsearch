import { randomUUID } from "node:crypto";
import type { Like } from "@closetsearch/shared";
import {
  clearLikes,
  deleteLike,
  findLikeByUserIdAndListingId,
  insertLike,
  listLikesByUserId,
} from "./db/repositories/likes.js";

export function resetLikeStore() {
  clearLikes();
}

export function addLike(userId: string, listingId: string, source: string) {
  const existingLike = findLikeByUserIdAndListingId(userId, listingId);

  if (existingLike) {
    return existingLike;
  }

  const like: Like = {
    id: randomUUID(),
    userId,
    listingId,
    source,
    createdAt: new Date().toISOString(),
  };

  return insertLike(like) ?? like;
}

export function removeLike(userId: string, listingId: string) {
  return deleteLike(userId, listingId);
}

export function getLikesByUserId(userId: string) {
  return listLikesByUserId(userId);
}
