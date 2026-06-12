import type { Brand } from "./brand";
import type { RiskSignal } from "./risk";

export type ListingType = "auction" | "buy_now" | "unknown";
export type ListingCondition =
  | "new_with_tags"
  | "new_without_tags"
  | "excellent"
  | "good"
  | "fair"
  | "unknown";

export interface Money {
  amount: number;
  currency: string;
}

export interface ListingSource {
  id: string;
  name: string;
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
  riskSignal?: RiskSignal;
}
