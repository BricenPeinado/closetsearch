import type { Listing, ListingCondition, ListingType } from "./listing";

export type SearchSortMode = "relevance" | "price_asc" | "price_desc" | "newest";

export interface PriceRange {
  min?: number;
  max?: number;
  currency?: string;
}

export interface SearchQuery {
  text: string;
  brandSlugs?: string[];
  sizes?: string[];
  categories?: string[];
  conditions?: ListingCondition[];
  sourceIds?: string[];
  listingTypes?: ListingType[];
  sort?: SearchSortMode;
  price?: PriceRange;
  currency?: string;
  cursor?: string;
  page?: number;
  pageSize?: number;
}

export interface SearchProviderSummary {
  providerId: string;
  providerName: string;
  status: "success" | "failure";
  resultCount: number;
}

export interface SearchResponse {
  query: SearchQuery;
  listings: Listing[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  page?: number;
  pageSize?: number;
  providers: SearchProviderSummary[];
}
