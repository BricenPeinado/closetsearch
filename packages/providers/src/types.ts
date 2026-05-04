import type {
  Listing,
  ListingType,
  SearchQuery,
  SearchSortMode,
} from "@closetsearch/shared";

export type ProviderFailureCode =
  | "unavailable"
  | "timeout"
  | "rate_limited"
  | "invalid_query"
  | "normalization_failed"
  | "unknown";

export interface ProviderFailure {
  providerId: string;
  code: ProviderFailureCode;
  message: string;
  retryable?: boolean;
}

export interface ProviderWarning {
  code: string;
  message: string;
}

export interface ProviderSearchMetadata {
  providerId: string;
  fetchedAt: string;
  resultCount?: number;
}

export interface ProviderSearchResult {
  providerId: string;
  status: "success";
  listings: Listing[];
  nextCursor?: string;
  hasMore?: boolean;
  warnings?: ProviderWarning[];
  metadata?: ProviderSearchMetadata;
}

export interface ProviderSearchFailure {
  providerId: string;
  status: "failure";
  failure: ProviderFailure;
}

export type ProviderSearchResponse =
  | ProviderSearchResult
  | ProviderSearchFailure;

export interface ProviderCapabilities {
  supportsPagination?: boolean;
  supportsPriceRange?: boolean;
  supportedListingTypes?: ListingType[];
  supportedSortModes?: SearchSortMode[];
}

export interface Provider {
  id: string;
  name: string;
  capabilities?: ProviderCapabilities;
  search(query: SearchQuery): Promise<ProviderSearchResponse>;
}
