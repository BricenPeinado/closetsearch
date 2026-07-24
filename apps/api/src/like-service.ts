import { randomUUID } from "node:crypto";
import type {
  DeleteLikeInput,
  Like,
  LikedListing,
  Listing,
  PersistLikeInput,
} from "@closetsearch/shared";
import {
  clearLikes,
  deleteLikeById,
  deleteLikeByListingId,
  findLikeByUserIdAndListingId,
  insertLike,
  listLikesByUserId,
  type StoredLikeRecord,
} from "./db/repositories/likes.js";
import { getRememberedListing, rememberListings } from "./services/listingCatalogService.js";

function toTrimmedString(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function titleCaseSource(source: string) {
  return source
    .split(/[-_\s]+/)
    .map((segment) => (segment.length > 0 ? segment[0].toUpperCase() + segment.slice(1) : ""))
    .join(" ");
}

function createPlaceholderImageDataUrl(source: string) {
  const label = encodeURIComponent(titleCaseSource(source) || "Saved Listing");
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><rect width="800" height="1000" fill="#f4f1ea"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#4b3d2b" font-family="Arial,sans-serif" font-size="44">${label}</text></svg>`,
  )}`;
}

function parseProviderListingId(listingId: string, source: string) {
  if (listingId.startsWith(`${source}:`)) {
    return listingId.slice(source.length + 1) || listingId;
  }

  const separatorIndex = listingId.indexOf(":");
  return separatorIndex >= 0 ? listingId.slice(separatorIndex + 1) : listingId;
}

function buildFallbackListing(record: StoredLikeRecord): Listing {
  const snapshot = record.listingSnapshot;
  const title = snapshot?.title || `Saved listing from ${titleCaseSource(record.like.source)}`;
  const sourceName = snapshot?.source.name || titleCaseSource(record.like.source);

  return {
    id: snapshot?.id || record.like.listingId,
    providerId: snapshot?.providerId || record.like.source,
    providerListingId:
      snapshot?.providerListingId ||
      parseProviderListingId(record.like.listingId, record.like.source),
    source: snapshot?.source || {
      id: record.like.source,
      name: sourceName,
    },
    sourceUrl: snapshot?.sourceUrl || "",
    title,
    brand: snapshot?.brand || {
      id: `brand:${record.like.source}:unknown`,
      slug: "unknown",
      name: "Unknown",
    },
    imageUrl: snapshot?.imageUrl || createPlaceholderImageDataUrl(record.like.source),
    price: snapshot?.price || {
      amount: 0,
      currency: "USD",
    },
    category: snapshot?.category,
    size: snapshot?.size,
    condition: snapshot?.condition,
    listingType: snapshot?.listingType || "unknown",
    fetchedAt: snapshot?.fetchedAt || record.like.createdAt,
    seller: snapshot?.seller,
    market: snapshot?.market,
    riskSignal: snapshot?.riskSignal,
  };
}

function toLikedListing(record: StoredLikeRecord): LikedListing {
  const cachedListing = getRememberedListing(record.like.listingId);

  if (cachedListing) {
    return {
      like: record.like,
      listing: cachedListing,
      snapshotStatus: "cache",
    };
  }

  if (record.listingSnapshot) {
    return {
      like: record.like,
      listing: record.listingSnapshot,
      snapshotStatus: "snapshot",
    };
  }

  return {
    like: record.like,
    listing: buildFallbackListing(record),
    snapshotStatus: "fallback",
  };
}

export function resetLikeStore() {
  clearLikes();
}

export function addLike(input: PersistLikeInput) {
  const listingSnapshot = input.listing;

  if (listingSnapshot) {
    rememberListings([listingSnapshot]);
  }

  const existingRecord = findLikeByUserIdAndListingId(input.userId, input.listingId);
  const record = existingRecord
    ? insertLike({
        like: existingRecord.like,
        listingSnapshot,
      })
    : insertLike({
        like: {
          id: randomUUID(),
          userId: input.userId,
          listingId: input.listingId,
          source: input.source,
          createdAt: new Date().toISOString(),
        },
        listingSnapshot,
      });

  if (!record) {
    throw new Error("Like could not be persisted.");
  }

  return toLikedListing(record);
}

export function removeLike(input: DeleteLikeInput) {
  if (toTrimmedString(input.id)) {
    return deleteLikeById(input.userId, input.id as string);
  }

  if (toTrimmedString(input.listingId)) {
    return deleteLikeByListingId(input.userId, input.listingId as string);
  }

  return false;
}

export function getLikesByUserId(userId: string): Like[] {
  return listLikesByUserId(userId).map((record) => record.like);
}

export function getLikedListingsByUserId(userId: string) {
  return listLikesByUserId(userId).map(toLikedListing);
}
