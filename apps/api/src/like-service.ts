import { randomUUID } from "node:crypto";
import type { Like } from "@closetsearch/shared";

const likesByUserId = new Map<string, Like[]>();

export function resetLikeStore() {
  likesByUserId.clear();
}

export function addLike(userId: string, listingId: string, source: string) {
  const existingLikes = likesByUserId.get(userId) ?? [];
  const existingLike = existingLikes.find((like) => like.listingId === listingId);

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

  likesByUserId.set(userId, [like, ...existingLikes]);

  return like;
}

export function removeLike(userId: string, listingId: string) {
  const existingLikes = likesByUserId.get(userId) ?? [];
  const nextLikes = existingLikes.filter((like) => like.listingId !== listingId);
  const removed = nextLikes.length !== existingLikes.length;

  likesByUserId.set(userId, nextLikes);

  return removed;
}

export function getLikesByUserId(userId: string) {
  return likesByUserId.get(userId) ?? [];
}
