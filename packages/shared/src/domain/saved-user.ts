import type { Like } from "./like";
import type { Listing, ListingType } from "./listing";
import type { SearchSortMode } from "./search";

export type SavedFilterListingType = Exclude<ListingType, "unknown">;

export interface LikedListing {
  like: Like;
  listing: Listing;
  snapshotStatus: "cache" | "snapshot" | "fallback";
}

export interface PersistLikeInput {
  listing?: Listing;
  listingId: string;
  source: string;
  userId: string;
}

export interface DeleteLikeInput {
  id?: string;
  listingId?: string;
  userId: string;
}

export interface SavedFilter {
  id: string;
  userId: string;
  label: string;
  queryText?: string;
  source?: string;
  listingType?: SavedFilterListingType;
  minPrice?: number;
  maxPrice?: number;
  sortMode?: SearchSortMode;
  createdAt: string;
  updatedAt: string;
}

export interface PersistSavedFilterInput {
  userId: string;
  label: string;
  queryText?: string;
  source?: string;
  listingType?: SavedFilterListingType;
  minPrice?: number;
  maxPrice?: number;
  sortMode?: SearchSortMode;
}

export interface DeleteSavedFilterInput {
  id: string;
  userId: string;
}

export interface Watchlist {
  id: string;
  userId: string;
  label: string;
  queryText?: string;
  brand?: string;
  maxPrice?: number;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistWatchlistInput {
  userId: string;
  label: string;
  queryText?: string;
  brand?: string;
  maxPrice?: number;
  source?: string;
}

export interface DeleteWatchlistInput {
  id: string;
  userId: string;
}

export interface UserSettings {
  userId: string;
  preferredCurrency: string;
  defaultSortMode?: SearchSortMode;
  preferredSources: string[];
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserSettingsInput {
  userId: string;
  preferredCurrency?: string;
  defaultSortMode?: SearchSortMode | null;
  preferredSources?: string[];
  displayName?: string | null;
}
