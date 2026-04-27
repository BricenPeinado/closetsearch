import type { ListingType } from "./listing";

export type SearchSortMode = "relevance" | "price_asc" | "price_desc" | "newest";

export interface PriceRange {
  min?: number;
  max?: number;
  currency?: string;
}

export interface SearchQuery {
  text: string;
  sourceId?: string;
  listingType?: ListingType;
  sort?: SearchSortMode;
  price?: PriceRange;
}
