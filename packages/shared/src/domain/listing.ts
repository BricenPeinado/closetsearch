import type { Brand } from "./brand.js";
import type { RiskSignal } from "./risk.js";

export type ListingType = "auction" | "buy_now" | "unknown";
export type ListingMarketStatus = "active" | "sold";
export type ListingAvailabilityStatus =
  | ListingMarketStatus
  | "stale"
  | "removed"
  | "unavailable"
  | "unknown";
export type ListingFreshnessStatus = "fresh" | "stale" | "unknown";
export type ListingDataOrigin =
  | "mock"
  | "official_api"
  | "partner_api"
  | "documented_feed"
  | "authorized_scraping";
export type ListingCondition =
  | "new_with_tags"
  | "new_without_tags"
  | "excellent"
  | "good"
  | "fair"
  | "unknown";
export type SellerTrustTier = "trusted" | "established" | "unverified" | "unknown";

export interface Money {
  /**
   * Backward-compatible major-unit value for display. New persistence and
   * comparison code should prefer amountMinor when it is present.
   */
  amount: number;
  /** Exact integer amount in the currency's minor unit. */
  amountMinor?: number;
  currency: string;
  /** Number of decimal places represented by amountMinor. */
  fractionDigits?: number;
}

export interface ConvertedMoney extends Money {
  exchangeRate: string;
  exchangeRateSource: string;
  exchangeRateTimestamp: string;
  sourceAmountMinor: number;
  sourceCurrency: string;
}

export interface ListingPricing {
  comparison?: ConvertedMoney;
  display?: ConvertedMoney;
  landed?: Money;
  original: Money;
  shipping?: Money;
}

export interface ListingSource {
  dataOrigin?: ListingDataOrigin;
  id: string;
  isMock?: boolean;
  marketplaceId?: string;
  name: string;
}

export interface ListingSeller {
  displayName?: string;
  feedbackPercentage?: number;
  username?: string;
  id?: string;
  feedbackScore?: number;
  feedbackCount?: number;
  location?: {
    city?: string;
    country?: string;
    region?: string;
  };
  profileUrl?: string;
  trustTier?: SellerTrustTier;
}

export interface ListingMarketMetrics {
  status: ListingMarketStatus;
  askingPrice?: Money;
  tags?: string[];
  priceDropsCount?: number;
  isExcludedFromAnalytics?: boolean;
  soldPrice?: Money;
}

export interface ListingImage {
  alt?: string;
  height?: number;
  role?: "primary" | "alternate" | "thumbnail";
  url: string;
  width?: number;
}

export interface ListingShipping {
  available?: boolean;
  cost?: Money;
  destinationCountry?: string;
  isFree?: boolean;
  maxEstimatedDeliveryAt?: string;
  minEstimatedDeliveryAt?: string;
  originCountry?: string;
  type?: string;
}

export interface ListingLifecycle {
  endedAt?: string;
  lastSeenAt?: string;
  listedAt?: string;
  observedAt: string;
  soldAt?: string;
  sourceUpdatedAt?: string;
  status: ListingAvailabilityStatus;
  unavailableAt?: string;
}

export interface ListingFreshness {
  observedAt: string;
  sourceUpdatedAt?: string;
  staleAt?: string;
  status: ListingFreshnessStatus;
}

export interface ListingAttribution {
  affiliate?: boolean;
  destinationUrl: string;
  displayText: string;
  logoUrl?: string;
  marketplaceName: string;
  required: boolean;
}

export interface ListingAnalyticsEligibility {
  eligible: boolean;
  exclusionReasons?: string[];
}

export interface Listing {
  id: string;
  providerId: string;
  source: ListingSource;
  providerListingId: string;
  sourceUrl: string;
  title: string;
  brand: Brand;
  imageUrl: string;
  images?: ListingImage[];
  price: Money;
  pricing?: ListingPricing;
  category?: string;
  size?: string;
  condition?: ListingCondition;
  listingType: ListingType;
  fetchedAt: string;
  analyticsEligibility?: ListingAnalyticsEligibility;
  attribution?: ListingAttribution;
  freshness?: ListingFreshness;
  lifecycle?: ListingLifecycle;
  seller?: ListingSeller;
  shipping?: ListingShipping;
  market?: ListingMarketMetrics;
  riskSignal?: RiskSignal;
}
