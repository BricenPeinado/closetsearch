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
  | "missing_credentials"
  | "authorization_required"
  | "unsupported_capability"
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

export interface ProviderPagination {
  cursor?: string;
  hasMore?: boolean;
  nextCursor?: string;
  nextPage?: number;
  page?: number;
  pageSize?: number;
  totalCount?: number;
}

export interface ProviderSearchMetadata {
  providerId: string;
  fetchedAt: string;
  pagination?: ProviderPagination;
  resultCount?: number;
}

export type ProviderSearchQuery = Omit<SearchQuery, "cursor" | "page" | "pageSize">;

export interface ProviderSearchRequest {
  pagination?: {
    cursor?: string;
    page?: number;
    pageSize?: number;
  };
  query: ProviderSearchQuery;
}

export interface ProviderSearchResult {
  providerId: string;
  status: "success";
  listings: Listing[];
  pagination?: ProviderPagination;
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
  supportsCursorPagination?: boolean;
  supportsPagePagination?: boolean;
  supportsPriceRange?: boolean;
  supportedListingTypes?: ListingType[];
  supportedSortModes?: SearchSortMode[];
}

export interface Provider {
  id: string;
  name: string;
  capabilities?: ProviderCapabilities;
  search(request: ProviderSearchRequest): Promise<ProviderSearchResponse>;
}
