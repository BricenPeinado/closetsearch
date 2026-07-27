import type { Listing, ListingDataOrigin, SearchSortMode } from "@closetsearch/shared";
import type {
  Provider,
  ProviderCapabilities,
  ProviderFailureCode,
  ProviderPagination,
  ProviderSearchFailure,
  ProviderSearchQuery,
  ProviderSearchRequest,
  ProviderSearchResponse,
  ProviderSearchResult,
  ProviderWarning,
} from "../types.js";
import { ProviderHttpError, type ProviderHttpMetric } from "../http/resilient-http.js";
import {
  createGrailedPagination,
  GRAILED_ALGOLIA_HITS_PER_PAGE,
  type GrailedAlgoliaResponse,
  normalizeGrailedAlgoliaHit,
  queryGrailedAlgolia,
} from "./algolia.js";
import {
  createGrailedCredentialCache,
  GrailedCredentialResolutionError,
  resolveGrailedAlgoliaCredentials,
  type GrailedCredentialCache,
} from "./credentials.js";
import { grailedFixtureListings, type RawGrailedFixtureListing } from "./fixtures.js";
import { createGrailedHttpClient, type GrailedFetch } from "./http-client.js";
import { createGrailedListingInputFromFixture, normalizeGrailedListing } from "./normalizer.js";
import { normalizeGrailedBaseUrl } from "./url-policy.js";

const GRAILED_PROVIDER_ID = "grailed";
const GRAILED_PROVIDER_NAME = "Grailed";
const defaultBaseUrl = "https://www.grailed.com";
const defaultUserAgent = "ClosetSearchBot/0.1 contact:<project-contact-email>";
const defaultRequestTimeoutMs = 5_000;
const defaultMinRequestIntervalMs = 3_000;
const defaultMaxResultsPerSearch = 24;
const defaultCredentialTtlMs = 15 * 60_000;

export type GrailedProviderRuntimeMode = "fixture" | "authorized-live";

export interface GrailedProviderOptions {
  authorizationReference?: string;
  backoffJitterRatio?: number;
  baseBackoffMs?: number;
  baseUrl?: string;
  circuitBreakerCooldownMs?: number;
  circuitBreakerFailureThreshold?: number;
  credentialTtlMs?: number;
  fetchImpl?: GrailedFetch;
  fixtureListings?: RawGrailedFixtureListing[];
  maxConcurrency?: number;
  maxRetries?: number;
  maxRetryAfterMs?: number;
  maxResultsPerSearch?: number;
  minRequestIntervalMs?: number;
  nowImpl?: () => number;
  onHttpMetric?: (metric: ProviderHttpMetric) => void;
  randomImpl?: () => number;
  requestTimeoutMs?: number;
  runtimeMode?: GrailedProviderRuntimeMode;
  scrapingAllowed?: boolean;
  sleepImpl?: (ms: number) => Promise<void>;
  userAgent?: string;
}

export const grailedProviderCapabilities: ProviderCapabilities = {
  dataOrigin: "authorized_scraping",
  paginationModel: "page",
  requiresAttribution: true,
  supportsActiveListings: true,
  supportsAttribution: true,
  supportsBrandFilter: false,
  supportsCategoryFilter: false,
  supportsChangeFeed: false,
  supportsConditionFilter: false,
  supportsPagination: true,
  supportsPagePagination: true,
  supportsCursorPagination: false,
  supportsPriceRange: false,
  supportsSearch: true,
  supportsSellerMetadata: true,
  supportsShipping: false,
  supportsSizeFilter: false,
  supportsSoldListings: true,
  supportsWebhooks: false,
  supportedListingTypes: ["auction", "buy_now", "unknown"],
  supportedMarketStatuses: ["active", "sold"],
  supportedSortModes: ["relevance", "newest"],
};

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasValidOptionalNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function parseGrailedAlgoliaResponse(value: unknown): GrailedAlgoliaResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.hits) ||
    !hasValidOptionalNumber(value, "hitsPerPage") ||
    !hasValidOptionalNumber(value, "nbHits") ||
    !hasValidOptionalNumber(value, "nbPages") ||
    !hasValidOptionalNumber(value, "page")
  ) {
    throw new ProviderHttpError(
      "Grailed response no longer matches the reviewed Algolia search schema.",
      {
        code: "invalid_response",
        retryable: false,
      },
    );
  }

  return value as unknown as GrailedAlgoliaResponse;
}

function createFailure(
  code: ProviderFailureCode,
  message: string,
  retryableOrOptions:
    | boolean
    | {
        retryAfterMs?: number;
        retryable?: boolean;
        statusCode?: number;
      } = false,
): ProviderSearchFailure {
  const options =
    typeof retryableOrOptions === "boolean"
      ? { retryable: retryableOrOptions }
      : retryableOrOptions;

  return {
    providerId: GRAILED_PROVIDER_ID,
    status: "failure",
    failure: {
      providerId: GRAILED_PROVIDER_ID,
      code,
      message,
      retryable: options.retryable === true,
      ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
      ...(options.statusCode === undefined ? {} : { statusCode: options.statusCode }),
    },
  };
}

function createSuccess(
  listings: ProviderSearchResult["listings"],
  pagination: ProviderPagination,
  warnings?: ProviderWarning[],
  dataOrigin: ListingDataOrigin = "authorized_scraping",
): ProviderSearchResult {
  return {
    providerId: GRAILED_PROVIDER_ID,
    status: "success",
    listings,
    pagination,
    warnings,
    metadata: {
      providerId: GRAILED_PROVIDER_ID,
      dataOrigin,
      fetchedAt: new Date().toISOString(),
      freshness: "fresh",
      resultCount: listings.length,
      pagination,
    },
  } satisfies ProviderSearchResult;
}

function toSearchTerms(text: string) {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function normalizePage(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.trunc(value);
}

function getFixtureResultLimit(
  pagination: ProviderSearchRequest["pagination"],
  maxResultsPerSearch: number,
) {
  const requestedPageSize = pagination?.pageSize;

  if (typeof requestedPageSize !== "number" || !Number.isFinite(requestedPageSize)) {
    return maxResultsPerSearch;
  }

  return Math.max(1, Math.min(maxResultsPerSearch, Math.trunc(requestedPageSize)));
}

function matchesListingQuery(listing: Listing, query: ProviderSearchQuery) {
  if (query.sourceIds?.length && !query.sourceIds.includes(GRAILED_PROVIDER_ID)) {
    return false;
  }

  const terms = toSearchTerms(query.text);

  if (terms.length > 0) {
    const haystack = [listing.title, listing.brand.name, listing.category ?? "", listing.size ?? ""]
      .join(" ")
      .toLowerCase();

    if (!terms.every((term) => haystack.includes(term))) {
      return false;
    }
  }

  if (query.brandSlugs?.length && !query.brandSlugs.includes(listing.brand.slug)) {
    return false;
  }

  if (
    query.categories?.length &&
    (!listing.category || !query.categories.includes(listing.category))
  ) {
    return false;
  }

  if (query.sizes?.length && (!listing.size || !query.sizes.includes(listing.size))) {
    return false;
  }

  if (
    query.conditions?.length &&
    (!listing.condition || !query.conditions.includes(listing.condition))
  ) {
    return false;
  }

  if (query.listingTypes?.length && !query.listingTypes.includes(listing.listingType)) {
    return false;
  }

  return true;
}

function matchesFixtureQuery(raw: RawGrailedFixtureListing, query: ProviderSearchQuery) {
  const listing = normalizeGrailedListing(createGrailedListingInputFromFixture(raw));

  return listing ? matchesListingQuery(listing, query) : false;
}

function sortFixtureListings(
  listings: RawGrailedFixtureListing[],
  sortMode: SearchSortMode = "relevance",
) {
  const sorted = [...listings];

  if (sortMode === "newest" || sortMode === "relevance") {
    sorted.sort(
      (left, right) =>
        new Date(right.publishedAt ?? 0).valueOf() - new Date(left.publishedAt ?? 0).valueOf(),
    );
  }

  return sorted;
}

async function searchFixtureListings(
  fixtureListings: RawGrailedFixtureListing[],
  request: ProviderSearchRequest,
  maxResultsPerSearch: number,
): Promise<ProviderSearchResult> {
  const page = normalizePage(request.pagination?.page);
  const pageSize = getFixtureResultLimit(request.pagination, maxResultsPerSearch);
  const matchedListings = sortFixtureListings(
    fixtureListings.filter((listing) => matchesFixtureQuery(listing, request.query)),
    request.query.sort,
  )
    .map((listing) => normalizeGrailedListing(createGrailedListingInputFromFixture(listing)))
    .filter((listing): listing is Listing => listing !== undefined)
    .map((normalizedListing) => ({
      ...normalizedListing,
      source: {
        ...normalizedListing.source,
        dataOrigin: "mock" as const,
        isMock: true,
      },
      analyticsEligibility: {
        eligible: false,
        exclusionReasons: ["recorded_fixture"],
      },
      market: normalizedListing.market
        ? {
            ...normalizedListing.market,
            isExcludedFromAnalytics: true,
          }
        : undefined,
    }));
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const listings = matchedListings.slice(startIndex, endIndex);
  const hasMore = endIndex < matchedListings.length;

  return createSuccess(
    listings,
    {
      page,
      pageSize,
      hasMore,
      nextPage: hasMore ? page + 1 : undefined,
      totalCount: matchedListings.length,
    },
    undefined,
    "mock",
  );
}

async function resolveLiveGrailedAlgoliaCredentials(
  client: ReturnType<typeof createGrailedHttpClient>,
  options: {
    baseUrl: string;
    credentialCache: GrailedCredentialCache;
    query: ProviderSearchQuery;
  },
) {
  return resolveGrailedAlgoliaCredentials({
    baseUrl: options.baseUrl,
    cache: options.credentialCache,
    client,
    queryText: options.query.text,
  });
}

async function queryGrailedWithCredentialRotation(
  client: ReturnType<typeof createGrailedHttpClient>,
  options: {
    baseUrl: string;
    credentialCache: GrailedCredentialCache;
    page: number;
    query: ProviderSearchQuery;
  },
) {
  let credentials = await resolveLiveGrailedAlgoliaCredentials(client, {
    baseUrl: options.baseUrl,
    credentialCache: options.credentialCache,
    query: options.query,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await queryGrailedAlgolia(client, {
      baseUrl: options.baseUrl,
      credentials,
      marketScope: options.query.marketScope,
      page: options.page,
      query: options.query,
    });

    if (response.status !== 401 && response.status !== 403) {
      return response;
    }

    if (attempt === 1) {
      return response;
    }

    options.credentialCache.clear();
    credentials = await resolveLiveGrailedAlgoliaCredentials(client, {
      baseUrl: options.baseUrl,
      credentialCache: options.credentialCache,
      query: options.query,
    });
  }

  throw new Error("Grailed credential rotation exhausted unexpectedly.");
}

async function searchAuthorizedLiveListings(
  request: ProviderSearchRequest,
  options: {
    authorizationReference: string;
    baseUrl: string;
    client: ReturnType<typeof createGrailedHttpClient>;
    credentialCache: GrailedCredentialCache;
    scrapingAllowed: boolean;
  },
): Promise<ProviderSearchResponse> {
  if (!options.scrapingAllowed || !toTrimmedString(options.authorizationReference)) {
    return createFailure(
      "authorization_required",
      "Grailed live access requires both GRAILED_SCRAPING_ALLOWED=true and a retained GRAILED_AUTHORIZATION_REFERENCE.",
    );
  }

  if (request.query.sourceIds?.length && !request.query.sourceIds.includes(GRAILED_PROVIDER_ID)) {
    return createSuccess([], {
      page: normalizePage(request.pagination?.page),
      pageSize: GRAILED_ALGOLIA_HITS_PER_PAGE,
      hasMore: false,
      totalCount: 0,
    });
  }

  const page = normalizePage(request.pagination?.page);

  try {
    const response = await queryGrailedWithCredentialRotation(options.client, {
      baseUrl: options.baseUrl,
      credentialCache: options.credentialCache,
      page,
      query: request.query,
    });

    if (response.status === 401 || response.status === 403) {
      return createFailure(
        "missing_credentials",
        "Grailed Algolia credentials were rejected after automatic refresh.",
      );
    }

    if (response.status === 429) {
      return createFailure(
        "rate_limited",
        "Grailed returned a rate-limit response. Back off before retrying.",
        true,
      );
    }

    if (!response.ok) {
      return createFailure(
        "unavailable",
        `Grailed Algolia request failed with status ${response.status}.`,
        response.status >= 500,
      );
    }

    const body = parseGrailedAlgoliaResponse(response.body);
    const hits = body.hits ?? [];
    const fetchedAt = new Date().toISOString();
    const normalizedListings = hits
      .map((hit) =>
        normalizeGrailedAlgoliaHit(hit, {
          baseUrl: options.baseUrl,
          fetchedAt,
          marketScope: request.query.marketScope,
        }),
      )
      .filter((listing): listing is Listing => listing !== undefined);
    const droppedListingCount = hits.length - normalizedListings.length;
    const listings = normalizedListings.filter((listing) =>
      matchesListingQuery(listing, request.query),
    );

    return createSuccess(
      listings,
      createGrailedPagination(body, page),
      droppedListingCount > 0
        ? [
            {
              code: "malformed_items_dropped",
              message: `Dropped ${droppedListingCount} malformed Grailed listing ${
                droppedListingCount === 1 ? "record" : "records"
              }.`,
              severity: "warning",
            },
          ]
        : undefined,
    );
  } catch (error) {
    if (error instanceof GrailedCredentialResolutionError) {
      return createFailure(error.code, error.message, error.retryable);
    }

    if (error instanceof ProviderHttpError) {
      return createFailure(error.code, error.message, {
        retryAfterMs: error.retryAfterMs,
        retryable: error.retryable,
        statusCode: error.statusCode,
      });
    }

    return createFailure(
      "unavailable",
      "Grailed scraping request failed before a response was returned.",
    );
  }
}

export function createGrailedProvider(options: GrailedProviderOptions = {}): Provider {
  const runtimeMode = options.runtimeMode ?? "fixture";
  const fixtureListings = options.fixtureListings ?? grailedFixtureListings;
  const configuredBaseUrl = toTrimmedString(options.baseUrl) || defaultBaseUrl;
  const baseUrl =
    runtimeMode === "authorized-live"
      ? normalizeGrailedBaseUrl(configuredBaseUrl)
      : configuredBaseUrl;
  const userAgent = toTrimmedString(options.userAgent) || defaultUserAgent;
  const requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs;
  const minRequestIntervalMs = options.minRequestIntervalMs ?? defaultMinRequestIntervalMs;
  const maxResultsPerSearch = options.maxResultsPerSearch ?? defaultMaxResultsPerSearch;
  const credentialTtlMs = options.credentialTtlMs ?? defaultCredentialTtlMs;
  const credentialCache = createGrailedCredentialCache(credentialTtlMs, options.nowImpl);
  const httpClient = options.fetchImpl
    ? createGrailedHttpClient({
        backoffJitterRatio: options.backoffJitterRatio,
        baseBackoffMs: options.baseBackoffMs,
        circuitBreakerCooldownMs: options.circuitBreakerCooldownMs,
        circuitBreakerFailureThreshold: options.circuitBreakerFailureThreshold,
        fetchImpl: options.fetchImpl,
        maxConcurrency: options.maxConcurrency,
        maxRetries: options.maxRetries,
        maxRetryAfterMs: options.maxRetryAfterMs,
        minRequestIntervalMs,
        nowImpl: options.nowImpl,
        onHttpMetric: options.onHttpMetric,
        randomImpl: options.randomImpl,
        requestTimeoutMs,
        sleepImpl: options.sleepImpl,
        userAgent,
      })
    : undefined;

  return {
    id: GRAILED_PROVIDER_ID,
    name: GRAILED_PROVIDER_NAME,
    dataOrigin: runtimeMode === "fixture" ? "mock" : "authorized_scraping",
    isMock: runtimeMode === "fixture",
    capabilities: grailedProviderCapabilities,
    async search(request) {
      if (runtimeMode === "fixture") {
        return searchFixtureListings(fixtureListings, request, maxResultsPerSearch);
      }

      if (options.scrapingAllowed !== true || !toTrimmedString(options.authorizationReference)) {
        return createFailure(
          "authorization_required",
          "Grailed live access requires both GRAILED_SCRAPING_ALLOWED=true and a retained GRAILED_AUTHORIZATION_REFERENCE.",
        );
      }

      if (!httpClient) {
        return createFailure(
          "unavailable",
          "Grailed authorized-live mode is configured but no server-side HTTP fetch implementation is available.",
        );
      }

      return searchAuthorizedLiveListings(request, {
        baseUrl,
        authorizationReference: toTrimmedString(options.authorizationReference),
        client: httpClient,
        credentialCache,
        scrapingAllowed: options.scrapingAllowed === true,
      });
    },
  };
}
