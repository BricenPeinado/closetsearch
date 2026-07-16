import type {
  ListingCondition,
  ListingMarketStatus,
  ListingType,
} from "./listing";

export interface PriceSnapshot {
  id: string;
  listingId: string;
  source: string;
  sourceListingId: string;
  brand?: string;
  category?: string;
  title?: string;
  imageUrl?: string;
  priceAmount: number;
  priceCurrency: string;
  normalizedPriceAmount: number;
  normalizedPriceCurrency: string;
  condition?: ListingCondition;
  size?: string;
  listingType: ListingType;
  marketStatus: ListingMarketStatus;
  sourceUrl: string;
  observedAt: string;
  lastSeenAt: string;
}

export interface ObservedMarketRange {
  averagePrice: number;
  count: number;
  currency: string;
  latestObservationAt: string;
  lowerQuartilePrice?: number;
  maxPrice: number;
  medianPrice: number;
  minPrice: number;
  upperQuartilePrice?: number;
}

export interface BrandMarketSummary {
  brand: string;
  range: ObservedMarketRange;
}

export interface CategoryMarketSummary {
  category: string;
  range: ObservedMarketRange;
}

export interface AnalyticsDataQuality {
  comparableListingCount: number;
  note: string;
  sampleSizeThreshold: number;
  status: "empty" | "limited" | "observed";
}

export interface AnalyticsDisclaimer {
  label: string;
  text: string;
}

export interface ListingPriceComparison {
  comparableCount: number;
  comparisonScope: string;
  currentCurrency: string;
  currentPrice: number;
  label: string;
  listingId: string;
  message: string;
  observedRange?: ObservedMarketRange;
  status: "currency_mismatch" | "limited_data" | "missing_price" | "observed";
}

export interface UnderpricedListingSignal {
  brand?: string;
  category?: string;
  comparableCount: number;
  comparisonScope: string;
  currentCurrency: string;
  currentPrice: number;
  id: string;
  imageUrl?: string;
  label: string;
  listingId: string;
  listingTitle: string;
  observedAt: string;
  observedCurrency: string;
  observedMaxPrice: number;
  observedMedianPrice: number;
  observedMinPrice: number;
  signalStrength: "below_observed_median" | "below_observed_range" | "near_observed_range";
  source: string;
  summary: string;
}

export interface PremiumAccess {
  userId: string;
  isPremium: boolean;
  planName: string;
  expiresAt?: string;
}

export interface AnalyticsOverview {
  dataQuality: AnalyticsDataQuality;
  disclaimers: AnalyticsDisclaimer[];
  latestObservationAt?: string;
  observedBrandCount: number;
  observedCategoryCount: number;
  observedListingCount: number;
  underMarketSignalCount: number;
}
