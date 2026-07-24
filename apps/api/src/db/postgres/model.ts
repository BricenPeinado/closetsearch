export type ListingType = "auction" | "buy_now" | "offer" | "unknown";
export type MarketStatus = "active" | "sold" | "unknown";
export type ListingAvailability = "available" | "removed" | "sold" | "stale" | "unavailable";

export interface ExactMoneyInput {
  amountMinor: bigint;
  currency: string;
}

export interface ComparisonMoneyInput extends ExactMoneyInput {
  exchangeRateObservedAt?: Date;
  exchangeRateSource?: string;
}

export interface ListingImageInput {
  height?: number;
  url: string;
  width?: number;
}

export interface ListingObservationInput {
  analyticsEligible: boolean;
  availability: ListingAvailability;
  canonicalBrandId?: string;
  canonicalFingerprint?: string;
  category?: string;
  comparisonPrice?: ComparisonMoneyInput;
  condition?: string;
  fetchedAt: Date;
  id: string;
  idempotencyKey: string;
  images: ListingImageInput[];
  landedPrice?: ExactMoneyInput;
  listedAt?: Date;
  listingType: ListingType;
  marketStatus: MarketStatus;
  observedAt: Date;
  originalPrice: ExactMoneyInput;
  providerBrand?: string;
  providerId: string;
  providerUpdatedAt?: Date;
  rawFingerprint?: string;
  sellerMetadata?: Record<string, unknown>;
  shippingMetadata?: Record<string, unknown>;
  shippingPrice?: ExactMoneyInput;
  size?: string;
  soldAt?: Date;
  soldPrice?: ExactMoneyInput;
  sourceListingId: string;
  sourceMarketplace: string;
  sourceUrl: string;
  staleAfter?: Date;
  title: string;
}

export interface ListingObservationResult {
  duplicate: boolean;
  lifecycleVersion: bigint;
  listingId: string;
  observationVersion?: bigint;
  persisted: boolean;
  result: "duplicate" | "ignored_stale" | "inserted" | "unchanged" | "updated";
}

export type EngagementEventType =
  | "conversion"
  | "filter_apply"
  | "hide"
  | "like"
  | "listing_open"
  | "listing_view"
  | "recommendation_impression"
  | "recommendation_request"
  | "saved_filter"
  | "saved_search"
  | "search_submit"
  | "unlike"
  | "watchlist_create";

export interface EngagementEventInput {
  eventId: string;
  eventType: EngagementEventType;
  listingId?: string;
  occurredAt: Date;
  privacySessionHash: string;
  properties?: Record<string, unknown>;
  rankedPosition?: number;
  requestId?: string;
  searchQueryHash?: string;
  userId?: string;
  viewportDurationMs?: number;
}
