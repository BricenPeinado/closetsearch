import type { Brand } from "./brand";

export type ListingType = "auction" | "buy_now" | "unknown";

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
  source: ListingSource;
  sourceListingId?: string;
  sourceUrl: string;
  title: string;
  brand?: Brand;
  imageUrl?: string;
  price: Money;
  listingType?: ListingType;
  fetchedAt?: string;
}
