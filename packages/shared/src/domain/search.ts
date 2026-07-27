import type {
  Listing,
  ListingCondition,
  ListingDataOrigin,
  ListingFreshnessStatus,
  ListingMarketStatus,
  ListingType,
} from "./listing.js";
import type { PaginationInfo } from "./pagination.js";

export type SearchSortMode =
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "newest"
  | "ending_soon"
  | "popularity"
  | "recommended";

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
  marketScope?: ListingMarketStatus;
  sort?: SearchSortMode;
  price?: PriceRange;
  currency?: string;
  cursor?: string;
  page?: number;
  pageSize?: number;
}

export interface SearchProviderSummary {
  cacheStatus?: "miss" | "fresh" | "stale";
  dataOrigin?: ListingDataOrigin;
  degraded?: boolean;
  failure?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  fetchedAt?: string;
  freshness?: ListingFreshnessStatus;
  latencyMs?: number;
  providerId: string;
  providerName: string;
  status: "success" | "failure";
  resultCount: number;
  warnings?: string[];
}

export interface SearchResponse {
  query: SearchQuery;
  listings: Listing[];
  pagination: PaginationInfo;
  providers: SearchProviderSummary[];
}
