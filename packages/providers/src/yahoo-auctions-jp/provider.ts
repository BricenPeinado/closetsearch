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
import { yahooAuctionsJpSearchFixture } from "./fixtures.js";
import { normalizeYahooAuctionsJpListing } from "./normalizer.js";
import { parseYahooAuctionsJpSearchResponse, YahooAuctionsJpSchemaError } from "./parser.js";
import type { YahooAuctionsJpRawListing } from "./raw.js";

const providerId = "yahoo-auctions-jp";
const providerName = "Yahoo! Auctions Japan";
const defaultBaseUrl = "https://auctions.yahoo.co.jp";
const allowedOrigins = new Set(["https://auctions.yahoo.co.jp"]);
const defaultUserAgent = "ClosetSearchBot/0.1 contact:<project-contact-email>";

export type YahooAuctionsJpProviderRuntimeMode = "fixture" | "authorized-live";

export const yahooAuctionsJpProviderCapabilities: ProviderCapabilities = {
  dataOrigin: "authorized_scraping",
  paginationModel: "page",
  requiresAttribution: true,
  supportsActiveListings: true,
  supportsAttribution: true,
  supportsAuctionMetadata: true,
  supportsBrandFilter: true,
  supportsCategoryFilter: true,
  supportsChangeFeed: false,
  supportsConditionFilter: true,
  supportsCursorPagination: false,
  supportsPagePagination: true,
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
  supportedListingTypes: ["auction", "buy_now"],
  supportedMarketStatuses: ["active", "sold"],
  supportedSortModes: [
    "relevance",
    "price_asc",
    "price_desc",
    "newest",
    "ending_soon",
    "popularity",
  ],
};

export interface YahooAuctionsJpProviderOptions {
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
  runtimeMode?: YahooAuctionsJpProviderRuntimeMode;
  scrapingAllowed?: boolean;
  sleepImpl?: (ms: number) => Promise<void>;
  userAgent?: string;
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value: string | undefined) {
  let url: URL;
  try {
    url = new URL(string(value) || defaultBaseUrl);
  } catch {
    throw new Error("Yahoo! Auctions Japan access requires the reviewed HTTPS marketplace origin.");
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
    throw new Error("Yahoo! Auctions Japan access requires the reviewed HTTPS marketplace origin.");
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
              message: `Dropped ${dropped} malformed Yahoo! Auctions Japan listing ${
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
    throw new YahooAuctionsJpSchemaError("Yahoo! Auctions Japan returned malformed JSON.");
  }
}

function sortParam(sort: SearchSortMode | undefined) {
  switch (sort) {
    case "price_asc":
      return "price";
    case "price_desc":
      return "-price";
    case "newest":
      return "-start";
    case "ending_soon":
      return "end";
    case "popularity":
      return "-bids";
    default:
      return "relevance";
  }
}

function expandedBrandAliases(slugs: string[] | undefined) {
  if (!slugs?.length) return [];
  return CANONICAL_BRANDS.filter((brand) => slugs.includes(brand.slug)).flatMap((brand) => [
    brand.name,
    ...(brand.aliases ?? []),
  ]);
}

export function buildYahooAuctionsJpSearchUrl(
  baseUrl: string,
  request: ProviderSearchRequest,
  maxResultsPerSearch = 100,
) {
  const url = new URL("/search/search", `${baseUrl}/`);
  const query = request.query;
  const page = Math.max(1, Math.trunc(request.pagination?.page ?? 1));
  const normalizedMaximum = Math.max(
    1,
    Math.min(100, Math.trunc(Number.isFinite(maxResultsPerSearch) ? maxResultsPerSearch : 100)),
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
  url.searchParams.set("q", string(query.text));
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  url.searchParams.set("sort", sortParam(query.sort));
  const brandAliases = expandedBrandAliases(query.brandSlugs);
  if (brandAliases.length) url.searchParams.set("brand_aliases", brandAliases.join("|"));
  if (query.categories?.length) url.searchParams.set("categories", query.categories.join(","));
  if (query.sizes?.length) url.searchParams.set("sizes", query.sizes.join(","));
  if (query.conditions?.length) url.searchParams.set("conditions", query.conditions.join(","));
  if (query.listingTypes?.length) url.searchParams.set("formats", query.listingTypes.join(","));
  if (query.marketScope) url.searchParams.set("status", query.marketScope);
  if (query.price?.min !== undefined) url.searchParams.set("price_min", String(query.price.min));
  if (query.price?.max !== undefined) url.searchParams.set("price_max", String(query.price.max));
  url.searchParams.set("currency", "JPY");
  return { page, pageSize, url: url.toString() };
}

function toHttpFailure(error: unknown) {
  if (error instanceof YahooAuctionsJpSchemaError) {
    return failure("invalid_response", error.message);
  }
  if (error instanceof ProviderHttpError) {
    return failure(error.code, error.message, {
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      statusCode: error.statusCode,
    });
  }
  return failure(
    "unavailable",
    "Yahoo! Auctions Japan search failed before receiving a usable response.",
    { retryable: true },
  );
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

export function createYahooAuctionsJpProvider(
  options: YahooAuctionsJpProviderOptions = {},
): Provider {
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
      100,
      Math.trunc(
        Number.isFinite(options.maxResultsPerSearch) ? (options.maxResultsPerSearch ?? 100) : 100,
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
    capabilities: yahooAuctionsJpProviderCapabilities,
    async search(request): Promise<ProviderSearchResponse> {
      const startedAt = nowImpl();
      const fetchedAt = new Date(nowImpl()).toISOString();
      if (request.query.sourceIds?.length && !request.query.sourceIds.includes(providerId)) {
        return success([], { hasMore: false, page: 1 }, fetchedAt, 0);
      }

      if (runtimeMode === "fixture") {
        const parsed = parseYahooAuctionsJpSearchResponse(yahooAuctionsJpSearchFixture);
        const matchingListings = parsed.listings
          .map((item) =>
            normalizeYahooAuctionsJpListing(item as YahooAuctionsJpRawListing, fetchedAt),
          )
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
            page: 1,
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
          "Yahoo! Auctions Japan live access requires YAHOO_AUCTIONS_JP_SCRAPING_ALLOWED=true and a retained YAHOO_AUCTIONS_JP_AUTHORIZATION_REFERENCE.",
        );
      }
      if (!client) {
        return failure(
          "unavailable",
          "Yahoo! Auctions Japan authorized-live mode requires server-side HTTP.",
        );
      }

      const search = buildYahooAuctionsJpSearchUrl(baseUrl, request, maxResultsPerSearch);
      try {
        const response = await client.request({
          operation: "yahoo_auctions_jp_search",
          url: search.url,
          headers: {
            accept: "application/json",
            "accept-language": "ja-JP,ja;q=0.9,en;q=0.6",
            "user-agent": userAgent,
          },
        });
        if (response.status === 401 || response.status === 403) {
          return failure(
            "authorization_required",
            "Yahoo! Auctions Japan rejected the authorized integration.",
            { statusCode: response.status },
          );
        }
        if (!response.ok) {
          return failure(
            "unavailable",
            `Yahoo! Auctions Japan search failed with status ${response.status}.`,
            {
              retryable: response.status >= 500,
              statusCode: response.status,
            },
          );
        }

        const parsed = parseYahooAuctionsJpSearchResponse(await json(response));
        const normalizedListings = parsed.listings
          .map((item) =>
            normalizeYahooAuctionsJpListing(item as YahooAuctionsJpRawListing, fetchedAt),
          )
          .filter((listing): listing is Listing => listing !== undefined);
        const listings = normalizedListings.slice(0, search.pageSize);
        const dropped = parsed.listings.length - normalizedListings.length;
        const nextPage = parsed.pagination?.nextPage;
        return success(
          listings,
          {
            page: search.page,
            pageSize: search.pageSize,
            hasMore: Boolean(nextPage),
            nextPage,
            totalCount: parsed.pagination?.total,
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
