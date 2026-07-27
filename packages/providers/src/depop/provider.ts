import type { Listing, SearchSortMode } from "@closetsearch/shared";
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
import { depopSearchFixture } from "./fixtures.js";
import { normalizeDepopProduct } from "./normalizer.js";
import { DepopSchemaError, parseDepopSearchResponse } from "./parser.js";
import type { DepopRawProduct } from "./raw.js";

const providerId = "depop";
const providerName = "Depop";
const defaultBaseUrl = "https://webapi.depop.com";
const allowedOrigins = new Set(["https://webapi.depop.com", "https://api.depop.com"]);
const defaultUserAgent = "ClosetSearchBot/0.1 contact:<project-contact-email>";

export type DepopProviderRuntimeMode = "fixture" | "authorized-live";

export const depopProviderCapabilities: ProviderCapabilities = {
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
  supportsOriginalLanguageText: false,
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

export interface DepopProviderOptions {
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
  runtimeMode?: DepopProviderRuntimeMode;
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
    throw new Error("Depop authorized-live access requires a reviewed HTTPS API origin.");
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
    throw new Error("Depop authorized-live access requires a reviewed HTTPS API origin.");
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
              message: `Dropped ${dropped} malformed Depop listing ${dropped === 1 ? "record" : "records"}.`,
              severity: "warning",
            },
          ]
        : undefined,
    metadata: {
      providerId,
      dataOrigin: "authorized_scraping",
      fetchedAt,
      freshness: "fresh",
      latencyMs,
      pagination,
      resultCount: listings.length,
    },
  };
}

async function json(response: ProviderHttpResponse) {
  const body = await response.text();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new DepopSchemaError("Depop returned malformed JSON.");
  }
}

function sortParam(sort: SearchSortMode | undefined) {
  switch (sort) {
    case "price_asc":
      return "price_asc";
    case "price_desc":
      return "price_desc";
    case "newest":
      return "newest";
    case "popularity":
      return "popular";
    case "recommended":
      return "recommended";
    default:
      return "relevance";
  }
}

function normalizedPageSize(requestedPageSize: number | undefined, maxResultsPerSearch = 100) {
  const normalizedMaximum = Math.max(
    1,
    Math.min(100, Math.trunc(Number.isFinite(maxResultsPerSearch) ? maxResultsPerSearch : 100)),
  );
  return Math.max(
    1,
    Math.min(
      normalizedMaximum,
      Math.trunc(Number.isFinite(requestedPageSize) ? (requestedPageSize ?? 50) : 50),
    ),
  );
}

function normalizedMaximumResults(value: number | undefined) {
  return Math.max(1, Math.min(100, Math.trunc(Number.isFinite(value) ? (value ?? 100) : 100)));
}

export function buildDepopSearchUrl(
  baseUrl: string,
  request: ProviderSearchRequest,
  maxResultsPerSearch = 100,
) {
  const url = new URL("/api/v2/search/products/", `${baseUrl}/`);
  const query = request.query;
  const pageSize = normalizedPageSize(request.pagination?.pageSize, maxResultsPerSearch);
  url.searchParams.set("q", string(query.text));
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("sort", sortParam(query.sort));
  if (request.pagination?.cursor) url.searchParams.set("cursor", request.pagination.cursor);
  if (query.brandSlugs?.length) url.searchParams.set("brands", query.brandSlugs.join(","));
  if (query.categories?.length) url.searchParams.set("categories", query.categories.join(","));
  if (query.sizes?.length) url.searchParams.set("sizes", query.sizes.join(","));
  if (query.conditions?.length) url.searchParams.set("conditions", query.conditions.join(","));
  if (query.marketScope) url.searchParams.set("status", query.marketScope);
  if (query.price?.min !== undefined) url.searchParams.set("price_min", String(query.price.min));
  if (query.price?.max !== undefined) url.searchParams.set("price_max", String(query.price.max));
  if (query.price?.currency ?? query.currency) {
    url.searchParams.set("currency", string(query.price?.currency ?? query.currency).toUpperCase());
  }
  return { pageSize, url: url.toString() };
}

function toHttpFailure(error: unknown): ProviderSearchFailure {
  if (error instanceof DepopSchemaError) {
    return failure("invalid_response", error.message);
  }
  if (error instanceof ProviderHttpError) {
    return failure(error.code, error.message, {
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      statusCode: error.statusCode,
    });
  }
  return failure("unavailable", "Depop search failed before receiving a usable response.", {
    retryable: true,
  });
}

function matchesFixture(listing: Listing, request: ProviderSearchRequest) {
  const query = request.query;
  const terms = string(query.text).toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [listing.title, listing.description, listing.brand.name, listing.category]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    terms.every((term) => haystack.includes(term)) &&
    (!query.brandSlugs?.length || query.brandSlugs.includes(listing.brand.slug)) &&
    (!query.categories?.length ||
      (listing.category !== undefined && query.categories.includes(listing.category))) &&
    (!query.sizes?.length || (listing.size !== undefined && query.sizes.includes(listing.size))) &&
    (!query.conditions?.length ||
      (listing.condition !== undefined && query.conditions.includes(listing.condition))) &&
    (!query.marketScope || listing.market?.status === query.marketScope)
  );
}

export function createDepopProvider(options: DepopProviderOptions = {}): Provider {
  const runtimeMode = options.runtimeMode ?? "fixture";
  const baseUrl =
    runtimeMode === "authorized-live"
      ? normalizeBaseUrl(options.baseUrl)
      : string(options.baseUrl) || defaultBaseUrl;
  const nowImpl = options.nowImpl ?? (() => Date.now());
  const userAgent = string(options.userAgent) || defaultUserAgent;
  const maxResultsPerSearch = normalizedMaximumResults(options.maxResultsPerSearch);
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
    capabilities: depopProviderCapabilities,
    async search(request): Promise<ProviderSearchResponse> {
      const startedAt = nowImpl();
      const fetchedAt = new Date(nowImpl()).toISOString();

      if (request.query.sourceIds?.length && !request.query.sourceIds.includes(providerId)) {
        return success(
          [],
          {
            hasMore: false,
            pageSize: normalizedPageSize(request.pagination?.pageSize, maxResultsPerSearch),
          },
          fetchedAt,
          0,
        );
      }

      if (runtimeMode === "fixture") {
        const parsed = parseDepopSearchResponse(depopSearchFixture);
        const matching = parsed.products
          .map((item) => normalizeDepopProduct(item as DepopRawProduct, fetchedAt))
          .filter((listing): listing is Listing => listing !== undefined)
          .filter((listing) => matchesFixture(listing, request));
        const pageSize = normalizedPageSize(request.pagination?.pageSize, maxResultsPerSearch);
        const normalized = matching.slice(0, pageSize).map((listing) => ({
          ...listing,
          source: { ...listing.source, dataOrigin: "mock" as const, isMock: true },
          analyticsEligibility: {
            eligible: false,
            exclusionReasons: ["recorded_fixture"],
          },
        }));
        return {
          ...success(
            normalized,
            {
              hasMore: matching.length > normalized.length,
              pageSize,
              totalCount: matching.length,
            },
            fetchedAt,
            Math.max(0, nowImpl() - startedAt),
          ),
          metadata: {
            providerId,
            dataOrigin: "mock",
            fetchedAt,
            freshness: "fresh",
            resultCount: normalized.length,
          },
        };
      }

      if (options.scrapingAllowed !== true || !string(options.authorizationReference)) {
        return failure(
          "authorization_required",
          "Depop live access requires DEPOP_SCRAPING_ALLOWED=true and a retained DEPOP_AUTHORIZATION_REFERENCE.",
        );
      }
      if (!client) {
        return failure("unavailable", "Depop authorized-live mode requires server-side HTTP.");
      }

      const search = buildDepopSearchUrl(baseUrl, request, maxResultsPerSearch);
      try {
        const response = await client.request({
          operation: "depop_search",
          url: search.url,
          headers: {
            accept: "application/json",
            "user-agent": userAgent,
          },
        });
        if (response.status === 401 || response.status === 403) {
          return failure("authorization_required", "Depop rejected the authorized integration.", {
            statusCode: response.status,
          });
        }
        if (!response.ok) {
          return failure("unavailable", `Depop search failed with status ${response.status}.`, {
            retryable: response.status >= 500,
            statusCode: response.status,
          });
        }

        const parsed = parseDepopSearchResponse(await json(response));
        const normalizedListings = parsed.products
          .map((item) => normalizeDepopProduct(item as DepopRawProduct, fetchedAt))
          .filter((listing): listing is Listing => listing !== undefined);
        const listings = normalizedListings.slice(0, search.pageSize);
        const dropped = parsed.products.length - normalizedListings.length;
        const nextCursor = parsed.meta?.nextCursor;
        return success(
          listings,
          {
            cursor: request.pagination?.cursor,
            hasMore: Boolean(nextCursor),
            nextCursor: nextCursor || undefined,
            pageSize: search.pageSize,
            totalCount: parsed.meta?.total,
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
