import type { Like } from "./like.js";
import type { Listing, ListingCondition, ListingType } from "./listing.js";
import type { SearchSortMode } from "./search.js";

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
  category?: string;
  source?: string;
  listingType?: SavedFilterListingType;
  minPriceAmount?: number;
  maxPriceAmount?: number;
  priceCurrency?: string;
  condition?: ListingCondition;
  size?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistInput {
  label?: string;
  queryText?: string;
  brand?: string;
  category?: string;
  source?: string;
  listingType?: SavedFilterListingType;
  minPriceAmount?: number;
  maxPriceAmount?: number;
  priceCurrency?: string;
  condition?: ListingCondition;
  size?: string;
  enabled?: boolean;
}

export interface PersistWatchlistInput extends WatchlistInput {
  userId: string;
}

export interface UpdateWatchlistInput extends WatchlistInput {
  id: string;
  userId: string;
}

export interface DeleteWatchlistInput {
  id: string;
  userId: string;
}

export type AlertFrequency = "instant" | "daily" | "weekly";
export type AlertDeliveryChannel = "email" | "push" | "sms" | "in_app";

export interface NotificationPreferences {
  userId: string;
  emailEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  frequency: AlertFrequency;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateNotificationPreferencesInput {
  userId: string;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
  smsEnabled?: boolean;
  inAppEnabled?: boolean;
  frequency?: AlertFrequency;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

export interface AlertMatchReason {
  code: string;
  label: string;
}

export type AlertMatchStatus = "candidate" | "dismissed";

export interface AlertMatch {
  id: string;
  userId: string;
  watchlistId: string;
  listingId: string;
  source: string;
  sourceListingId: string;
  reasons: AlertMatchReason[];
  status: AlertMatchStatus;
  firstMatchedAt: string;
  lastMatchedAt: string;
  dismissedAt?: string;
}

export interface PersistAlertMatchInput {
  userId: string;
  watchlistId: string;
  listingId: string;
  source: string;
  sourceListingId: string;
  reasons: AlertMatchReason[];
  status?: AlertMatchStatus;
  dismissedAt?: string;
}

export interface AlertMatchResult {
  matched: boolean;
  reasons: AlertMatchReason[];
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
