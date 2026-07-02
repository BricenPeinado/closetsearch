import type { Brand } from "./brand";
import type { RiskSignal } from "./risk";

export type ListingType = "auction" | "buy_now" | "unknown";
export type ListingMarketStatus = "active" | "sold";
export type ListingCondition =
  | "new_with_tags"
  | "new_without_tags"
  | "excellent"
  | "good"
  | "fair"
  | "unknown";
export type SellerTrustTier = "trusted" | "established" | "unverified" | "unknown";

export interface Money {
  amount: number;
  currency: string;
}

export interface ListingSource {
  id: string;
  name: string;
}

export interface ListingSeller {
  username?: string;
  feedbackScore?: number;
  feedbackCount?: number;
  trustTier?: SellerTrustTier;
}

export interface ListingMarketMetrics {
  status: ListingMarketStatus;
  tags?: string[];
  priceDropsCount?: number;
  isExcludedFromAnalytics?: boolean;
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
  price: Money;
  category?: string;
  size?: string;
  condition?: ListingCondition;
  listingType: ListingType;
  fetchedAt: string;
  seller?: ListingSeller;
  market?: ListingMarketMetrics;
  riskSignal?: RiskSignal;
}
