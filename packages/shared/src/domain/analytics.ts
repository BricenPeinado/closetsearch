import type { Brand } from "./brand";

export interface MarketInsight {
  id: string;
  brand: Brand;
  category: string;
  title: string;
  summary: string;
  confidence: number;
  createdAt: string;
}

export interface UnderpricedListingSignal {
  id: string;
  listingId: string;
  source: string;
  listingTitle: string;
  currentPrice: number;
  estimatedMarketPrice: number;
  currency: string;
  percentBelowMarket: number;
  confidence: number;
  reason: string;
  createdAt: string;
}

export interface PremiumAccess {
  userId: string;
  isPremium: boolean;
  planName: string;
  expiresAt?: string;
}

export interface AnalyticsOverview {
  trackedBrands: number;
  marketInsightCount: number;
  underpricedSignalCount: number;
  lastUpdatedAt: string;
}
