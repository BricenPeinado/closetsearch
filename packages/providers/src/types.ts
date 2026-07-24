import type {
  Listing,
  ListingCondition,
  ListingDataOrigin,
  ListingMarketStatus,
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
  | "circuit_open"
  | "invalid_response"
  | "unknown";

export interface ProviderFailure {
  providerId: string;
  code: ProviderFailureCode;
  classification?: "retryable" | "terminal";
  message: string;
  retryAfterMs?: number;
  retryable?: boolean;
  statusCode?: number;
}

export interface ProviderWarning {
  code: string;
  message: string;
  severity?: "info" | "warning";
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
  cacheStatus?: "miss" | "fresh" | "stale";
  dataOrigin?: ListingDataOrigin;
  providerId: string;
  fetchedAt: string;
  freshness?: "fresh" | "stale" | "unknown";
  latencyMs?: number;
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

export type ProviderSearchResponse = ProviderSearchResult | ProviderSearchFailure;

export interface ProviderCapabilities {
  dataOrigin?: ListingDataOrigin;
  paginationModel?: "none" | "page" | "cursor" | "offset";
  requiresAttribution?: boolean;
  supportsActiveListings?: boolean;
  supportsAttribution?: boolean;
  supportsBrandFilter?: boolean;
  supportsCategoryFilter?: boolean;
  supportsChangeFeed?: boolean;
  supportsConditionFilter?: boolean;
  supportsPagination?: boolean;
  supportsCursorPagination?: boolean;
  supportsPagePagination?: boolean;
  supportsPriceRange?: boolean;
  supportsSearch?: boolean;
  supportsSellerMetadata?: boolean;
  supportsShipping?: boolean;
  supportsSizeFilter?: boolean;
  supportsSoldListings?: boolean;
  supportsWebhooks?: boolean;
  supportedConditions?: ListingCondition[];
  supportedListingTypes?: ListingType[];
  supportedMarketStatuses?: ListingMarketStatus[];
  supportedSortModes?: SearchSortMode[];
}

export interface Provider {
  dataOrigin?: ListingDataOrigin;
  id: string;
  isMock?: boolean;
  name: string;
  capabilities?: ProviderCapabilities;
  search(request: ProviderSearchRequest): Promise<ProviderSearchResponse>;
}
