import { CANONICAL_BRANDS, type Listing, type SearchSortMode } from "@closetsearch/shared";
import {
  createResilientHttpClient,
  ProviderHttpError,
  type ProviderFetch,
  type ProviderHttpMetric,
  type ProviderHttpResponse,
} from "../http/resilient-http.js";
import type {
  Provider,
  ProviderCapabilities,
  ProviderFailureCode,
  ProviderSearchFailure,
  ProviderSearchRequest,
  ProviderSearchResponse,
  ProviderSearchResult,
} from "../types.js";
import { mercariJpSearchFixture } from "./fixtures.js";
import { normalizeMercariJpItem } from "./normalizer.js";
import { MercariJpSchemaError, parseMercariJpSearchResponse } from "./parser.js";
import type { MercariJpRawItem } from "./raw.js";

const providerId = "mercari-jp";
const providerName = "Mercari Japan";
const defaultBaseUrl = "https://api.mercari.jp";
const allowedOrigins = new Set(["https://api.mercari.jp"]);
const defaultUserAgent = "ClosetSearchBot/0.1 contact:<project-contact-email>";

export type MercariJpProviderRuntimeMode = "fixture" | "authorized-live";

export const mercariJpProviderCapabilities: ProviderCapabilities = {
  dataOrigin: "authorized_scraping",
  paginationModel: "cursor",
  requiresAttribution: true,
  supportsActiveListings: true,
  supportsAttribution: true,
  supportsAuctionMetadata: false,
  supportsBrandFilter: true,
  supportsCategoryFilter: true,
  supportsChangeFeed: false,
  supportsConditionFilter: true,
  supportsCursorPagination: true,
  supportsPagePagination: false,
  supportsPagination: true,
  supportsPriceRange: true,
  supportsSearch: true,
  supportsSellerMetadata: true,
  supportsShipping: true,
  supportsShippingLimitations: true,
  supportsSizeFilter: true,
  supportsSoldListings: true,
  supportsOriginalLanguageText: true,
  supportsWebhooks: false,
  supportedListingTypes: ["buy_now"],
  supportedMarketStatuses: ["active", "sold"],
  supportedSortModes: [
    "relevance",
    "price_asc",
    "price_desc",
    "newest",
    "popularity",
    "recommended",
  ],
};

export interface MercariJpProviderOptions {
  authorizationReference?: string;
  backoffJitterRatio?: number;
  baseBackoffMs?: number;
  baseUrl?: string;
  circuitBreakerCooldownMs?: number;
  circuitBreakerFailureThreshold?: number;
  fetchImpl?: ProviderFetch;
  maxConcurrency?: number;
  maxResultsPerSearch?: number;
  maxRetries?: number;
  maxRetryAfterMs?: number;
  minRequestIntervalMs?: number;
  nowImpl?: () => number;
  onHttpMetric?: (metric: ProviderHttpMetric) => void;
  randomImpl?: () => number;
  requestTimeoutMs?: number;
  runtimeMode?: MercariJpProviderRuntimeMode;
  scrapingAllowed?: boolean;
  sleepImpl?: (ms: number) => Promise<void>;
  userAgent?: string;
}

export interface MercariJpSearchPayload {
  filters: {
    brandAliases?: string[];
    categories?: string[];
    conditions?: string[];
    maxPrice?: number;
    minPrice?: number;
    sizes?: string[];
    status?: "active" | "sold";
  };
  pageSize: number;
  pageToken?: string;
  searchKeyword: string;
  sort: string;
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value: string | undefined) {
  let url: URL;
  try {
    url = new URL(string(value) || defaultBaseUrl);
  } catch {
    throw new Error("Mercari Japan access requires the reviewed HTTPS API origin.");
  }
  if (
    url.protocol !== "https:" ||
    !allowedOrigins.has(url.origin) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("Mercari Japan access requires the reviewed HTTPS API origin.");
  }
  return url.origin;
}

function failure(
  code: ProviderFailureCode,
  message: string,
  options: { retryable?: boolean; retryAfterMs?: number; statusCode?: number } = {},
): ProviderSearchFailure {
  const retryable = options.retryable === true;
  return {
    providerId,
    status: "failure",
    failure: {
      providerId,
      code,
      classification: retryable ? "retryable" : "terminal",
      message,
      retryable,
      retryAfterMs: options.retryAfterMs,
      statusCode: options.statusCode,
    },
  };
}

function success(
  listings: Listing[],
  pagination: ProviderSearchResult["pagination"],
  fetchedAt: string,
  latencyMs: number,
  dropped = 0,
  dataOrigin: "authorized_scraping" | "mock" = "authorized_scraping",
): ProviderSearchResult {
  return {
    providerId,
    status: "success",
    listings,
    pagination,
    warnings:
      dropped > 0
        ? [
            {
              code: "malformed_items_dropped",
              message: `Dropped ${dropped} malformed Mercari Japan listing ${
                dropped === 1 ? "record" : "records"
              }.`,
              severity: "warning",
            },
          ]
        : undefined,
    metadata: {
      providerId,
      dataOrigin,
      fetchedAt,
      freshness: "fresh",
      latencyMs,
      pagination,
      resultCount: listings.length,
    },
  };
}

async function json(response: ProviderHttpResponse) {
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    throw new MercariJpSchemaError("Mercari Japan returned malformed JSON.");
  }
}

function sortParam(sort: SearchSortMode | undefined) {
  switch (sort) {
    case "price_asc":
      return "SORT_PRICE_ASC";
    case "price_desc":
      return "SORT_PRICE_DESC";
    case "newest":
      return "SORT_CREATED_DESC";
    case "popularity":
      return "SORT_LIKES_DESC";
    case "recommended":
      return "SORT_RECOMMENDED";
    default:
      return "SORT_RELEVANCE";
  }
}

function expandedBrandAliases(slugs: string[] | undefined) {
  if (!slugs?.length) return undefined;
  const aliases = CANONICAL_BRANDS.filter((brand) => slugs.includes(brand.slug)).flatMap(
    (brand) => [brand.name, ...(brand.aliases ?? [])],
  );
  return aliases.length ? aliases : undefined;
}

export function buildMercariJpSearchRequest(
  baseUrl: string,
  request: ProviderSearchRequest,
  maxResultsPerSearch = 120,
) {
  const query = request.query;
  const normalizedMaximum = Math.max(
    1,
    Math.min(120, Math.trunc(Number.isFinite(maxResultsPerSearch) ? maxResultsPerSearch : 120)),
  );
  const pageSize = Math.max(
    1,
    Math.min(
      normalizedMaximum,
      Math.trunc(
        Number.isFinite(request.pagination?.pageSize) ? (request.pagination?.pageSize ?? 50) : 50,
      ),
    ),
  );
  const payload: MercariJpSearchPayload = {
    searchKeyword: string(query.text),
    pageSize,
    pageToken: request.pagination?.cursor || undefined,
    sort: sortParam(query.sort),
    filters: {
      brandAliases: expandedBrandAliases(query.brandSlugs),
      categories: query.categories,
      sizes: query.sizes,
      conditions: query.conditions,
      minPrice: query.price?.min,
      maxPrice: query.price?.max,
      status: query.marketScope,
    },
  };
  return {
    body: JSON.stringify(payload),
    pageSize,
    payload,
    url: new URL("/v2/entities:search", `${baseUrl}/`).toString(),
  };
}

function toHttpFailure(error: unknown) {
  if (error instanceof MercariJpSchemaError) {
    return failure("invalid_response", error.message);
  }
  if (error instanceof ProviderHttpError) {
    return failure(error.code, error.message, {
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      statusCode: error.statusCode,
    });
  }
  return failure("unavailable", "Mercari Japan search failed before receiving a usable response.", {
    retryable: true,
  });
}

function matchesFixture(listing: Listing, request: ProviderSearchRequest) {
  const query = request.query;
  const terms = string(query.text).toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [
    listing.title,
    listing.originalTitle,
    listing.description,
    listing.originalDescription,
    listing.brand.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    terms.every((term) => haystack.includes(term)) &&
    (!query.brandSlugs?.length || query.brandSlugs.includes(listing.brand.slug)) &&
    (!query.marketScope || listing.market?.status === query.marketScope)
  );
}

export function createMercariJpProvider(options: MercariJpProviderOptions = {}): Provider {
  const runtimeMode = options.runtimeMode ?? "fixture";
  const baseUrl =
    runtimeMode === "authorized-live"
      ? normalizeBaseUrl(options.baseUrl)
      : string(options.baseUrl) || defaultBaseUrl;
  const nowImpl = options.nowImpl ?? (() => Date.now());
  const userAgent = string(options.userAgent) || defaultUserAgent;
  const maxResultsPerSearch = Math.max(
    1,
    Math.min(
      120,
      Math.trunc(
        Number.isFinite(options.maxResultsPerSearch) ? (options.maxResultsPerSearch ?? 120) : 120,
      ),
    ),
  );
  const client = options.fetchImpl
    ? createResilientHttpClient({
        backoffJitterRatio: options.backoffJitterRatio,
        baseBackoffMs: options.baseBackoffMs,
        circuitBreakerCooldownMs: options.circuitBreakerCooldownMs,
        circuitBreakerFailureThreshold: options.circuitBreakerFailureThreshold,
        fetchImpl: options.fetchImpl,
        maxConcurrency: options.maxConcurrency,
        maxRetries: options.maxRetries,
        maxRetryAfterMs: options.maxRetryAfterMs,
        minRequestIntervalMs: options.minRequestIntervalMs,
        nowImpl,
        onMetric: options.onHttpMetric,
        randomImpl: options.randomImpl,
        requestTimeoutMs: options.requestTimeoutMs,
        sleepImpl: options.sleepImpl,
      })
    : undefined;

  return {
    id: providerId,
    name: providerName,
    dataOrigin: runtimeMode === "fixture" ? "mock" : "authorized_scraping",
    isMock: runtimeMode === "fixture",
    capabilities: mercariJpProviderCapabilities,
    async search(request): Promise<ProviderSearchResponse> {
      const startedAt = nowImpl();
      const fetchedAt = new Date(nowImpl()).toISOString();
      if (request.query.sourceIds?.length && !request.query.sourceIds.includes(providerId)) {
        return success([], { hasMore: false }, fetchedAt, 0);
      }

      if (runtimeMode === "fixture") {
        const parsed = parseMercariJpSearchResponse(mercariJpSearchFixture);
        const matchingListings = parsed.items
          .map((item) => normalizeMercariJpItem(item as MercariJpRawItem, fetchedAt))
          .filter((listing): listing is Listing => listing !== undefined)
          .filter((listing) => matchesFixture(listing, request));
        const pageSize = Math.max(
          1,
          Math.min(
            maxResultsPerSearch,
            Math.trunc(
              Number.isFinite(request.pagination?.pageSize)
                ? (request.pagination?.pageSize ?? 50)
                : 50,
            ),
          ),
        );
        const listings = matchingListings.slice(0, pageSize).map((listing) => ({
          ...listing,
          source: { ...listing.source, dataOrigin: "mock" as const, isMock: true },
          analyticsEligibility: {
            eligible: false,
            exclusionReasons: ["recorded_fixture"],
          },
        }));
        return success(
          listings,
          {
            hasMore: matchingListings.length > listings.length,
            pageSize,
            totalCount: matchingListings.length,
          },
          fetchedAt,
          Math.max(0, nowImpl() - startedAt),
          0,
          "mock",
        );
      }

      if (options.scrapingAllowed !== true || !string(options.authorizationReference)) {
        return failure(
          "authorization_required",
          "Mercari Japan live access requires MERCARI_JP_SCRAPING_ALLOWED=true and a retained MERCARI_JP_AUTHORIZATION_REFERENCE.",
        );
      }
      if (!client) {
        return failure(
          "unavailable",
          "Mercari Japan authorized-live mode requires server-side HTTP.",
        );
      }

      const search = buildMercariJpSearchRequest(baseUrl, request, maxResultsPerSearch);
      try {
        const response = await client.request({
          operation: "mercari_jp_search",
          url: search.url,
          method: "POST",
          body: search.body,
          headers: {
            accept: "application/json",
            "accept-language": "ja-JP,ja;q=0.9,en;q=0.6",
            "content-type": "application/json",
            "user-agent": userAgent,
          },
        });
        if (response.status === 401 || response.status === 403) {
          return failure(
            "authorization_required",
            "Mercari Japan rejected the authorized integration.",
            {
              statusCode: response.status,
            },
          );
        }
        if (!response.ok) {
          return failure(
            "unavailable",
            `Mercari Japan search failed with status ${response.status}.`,
            {
              retryable: response.status >= 500,
              statusCode: response.status,
            },
          );
        }

        const parsed = parseMercariJpSearchResponse(await json(response));
        const normalizedListings = parsed.items
          .map((item) => normalizeMercariJpItem(item as MercariJpRawItem, fetchedAt))
          .filter((listing): listing is Listing => listing !== undefined);
        const listings = normalizedListings.slice(0, search.pageSize);
        const dropped = parsed.items.length - normalizedListings.length;
        return success(
          listings,
          {
            cursor: request.pagination?.cursor,
            hasMore: Boolean(parsed.nextPageToken),
            nextCursor: parsed.nextPageToken,
            pageSize: search.pageSize,
            totalCount: parsed.total,
          },
          fetchedAt,
          Math.max(0, nowImpl() - startedAt),
          dropped,
        );
      } catch (error) {
        return toHttpFailure(error);
      }
    },
  };
}
