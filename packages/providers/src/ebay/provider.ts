import type {
  Provider,
  ProviderCapabilities,
  ProviderFailureCode,
  ProviderPagination,
  ProviderSearchFailure,
  ProviderSearchRequest,
  ProviderSearchResponse,
  ProviderSearchResult,
  ProviderWarning,
} from "../types.js";
import {
  createResilientHttpClient,
  ProviderHttpError,
  type ProviderFetch,
  type ProviderHttpMetric,
  type ProviderHttpResponse,
} from "../http/resilient-http.js";
import { normalizeEbayItemSummary } from "./normalizer.js";
import type {
  EbayRawBrowseResponse,
  EbayRawItemSummary,
  EbayRawOAuthResponse,
} from "./raw.js";

const ebayProviderId = "ebay";
const ebayProviderName = "eBay";
const defaultApiBaseUrl = "https://api.ebay.com";
const defaultIdentityBaseUrl = "https://api.ebay.com";
const defaultMarketplaceId = "EBAY_US";
const defaultOAuthScope = "https://api.ebay.com/oauth/api_scope";
const defaultSearchQuery = "designer clothing";
const defaultPageSize = 50;
const maxPageSize = 200;

export const ebayProviderCapabilities: ProviderCapabilities = {
  dataOrigin: "official_api",
  paginationModel: "offset",
  requiresAttribution: true,
  supportsActiveListings: true,
  supportsAttribution: true,
  supportsBrandFilter: false,
  supportsCategoryFilter: false,
  supportsChangeFeed: false,
  supportsConditionFilter: false,
  supportsCursorPagination: false,
  supportsPagePagination: true,
  supportsPagination: true,
  supportsPriceRange: true,
  supportsSearch: true,
  supportsSellerMetadata: true,
  supportsShipping: true,
  supportsSizeFilter: false,
  supportsSoldListings: false,
  supportsWebhooks: false,
  supportedListingTypes: ["auction", "buy_now"],
  supportedMarketStatuses: ["active"],
  supportedSortModes: ["relevance", "price_asc", "price_desc", "newest"],
};

export interface EbayProviderOptions {
  affiliateCampaignId?: string;
  affiliateReferenceId?: string;
  apiBaseUrl?: string;
  baseBackoffMs?: number;
  circuitBreakerCooldownMs?: number;
  circuitBreakerFailureThreshold?: number;
  clientId?: string;
  clientSecret?: string;
  defaultSearchQuery?: string;
  fetchImpl?: ProviderFetch;
  identityBaseUrl?: string;
  marketplaceId?: string;
  maxConcurrency?: number;
  maxRetries?: number;
  minRequestIntervalMs?: number;
  nowImpl?: () => number;
  oauthScope?: string;
  onHttpMetric?: (metric: ProviderHttpMetric) => void;
  requestTimeoutMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  const normalizedValue = toTrimmedString(value) || fallback;
  return normalizedValue.endsWith("/")
    ? normalizedValue.slice(0, -1)
    : normalizedValue;
}

function createFailure(
  code: ProviderFailureCode,
  message: string,
  options: {
    retryAfterMs?: number;
    retryable?: boolean;
    statusCode?: number;
  } = {},
): ProviderSearchFailure {
  const retryable = options.retryable === true;

  return {
    providerId: ebayProviderId,
    status: "failure",
    failure: {
      providerId: ebayProviderId,
      code,
      classification: retryable ? "retryable" : "terminal",
      message,
      retryAfterMs: options.retryAfterMs,
      retryable,
      statusCode: options.statusCode,
    },
  };
}

function createSuccess(
  listings: ProviderSearchResult["listings"],
  pagination: ProviderPagination,
  metadata: {
    fetchedAt: string;
    latencyMs: number;
  },
  warnings?: ProviderWarning[],
): ProviderSearchResult {
  return {
    providerId: ebayProviderId,
    status: "success",
    listings,
    pagination,
    warnings,
    metadata: {
      providerId: ebayProviderId,
      dataOrigin: "official_api",
      fetchedAt: metadata.fetchedAt,
      freshness: "fresh",
      latencyMs: metadata.latencyMs,
      pagination,
      resultCount: listings.length,
    },
  };
}

async function parseJsonResponse<T>(response: ProviderHttpResponse): Promise<T> {
  const body = await response.text();

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ProviderHttpError(
      "eBay returned a malformed JSON response.",
      {
        code: "invalid_response",
        retryable: false,
        statusCode: response.status,
      },
    );
  }
}

function normalizePage(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.trunc(value)
    : 1;
}

function normalizePageSize(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.min(maxPageSize, Math.trunc(value))
    : defaultPageSize;
}

function validateQuery(
  request: ProviderSearchRequest,
): ProviderSearchFailure | undefined {
  const query = request.query;

  if (query.marketScope === "sold") {
    return createFailure(
      "unsupported_capability",
      "eBay Browse exposes active purchasable inventory, not general sold-listing history.",
    );
  }

  if (query.brandSlugs?.length) {
    return createFailure(
      "unsupported_capability",
      "eBay Browse brand aspects require provider category identifiers and cannot safely consume normalized brand slugs.",
    );
  }

  if (query.categories?.length) {
    return createFailure(
      "unsupported_capability",
      "eBay Browse category filters require eBay taxonomy identifiers, not normalized ClosetSearch category names.",
    );
  }

  if (query.sizes?.length || query.conditions?.length) {
    return createFailure(
      "unsupported_capability",
      "eBay Browse cannot safely apply the requested normalized size or condition filters without taxonomy-specific mapping.",
    );
  }

  if (
    query.listingTypes?.some(
      (listingType) => listingType !== "auction" && listingType !== "buy_now",
    )
  ) {
    return createFailure(
      "unsupported_capability",
      "eBay Browse cannot filter for unknown listing types.",
    );
  }

  if (
    query.price &&
    query.price.min !== undefined &&
    (!Number.isFinite(query.price.min) || query.price.min < 0)
  ) {
    return createFailure("invalid_query", "Minimum price must be non-negative.");
  }

  if (
    query.price &&
    query.price.max !== undefined &&
    (!Number.isFinite(query.price.max) || query.price.max < 0)
  ) {
    return createFailure("invalid_query", "Maximum price must be non-negative.");
  }

  if (
    query.price?.min !== undefined &&
    query.price.max !== undefined &&
    query.price.min > query.price.max
  ) {
    return createFailure(
      "invalid_query",
      "Minimum price cannot exceed maximum price.",
    );
  }

  if (
    query.price &&
    (query.price.min !== undefined || query.price.max !== undefined) &&
    !toTrimmedString(query.price.currency ?? query.currency)
  ) {
    return createFailure(
      "invalid_query",
      "eBay Browse price filters require an explicit three-letter currency.",
    );
  }

  return undefined;
}

function mapSort(sort: ProviderSearchRequest["query"]["sort"]) {
  switch (sort) {
    case "price_asc":
      return "price";
    case "price_desc":
      return "-price";
    case "newest":
      return "newlyListed";
    case "relevance":
    default:
      return undefined;
  }
}

function buildSearchUrl(
  apiBaseUrl: string,
  request: ProviderSearchRequest,
  defaultQuery: string,
) {
  const page = normalizePage(request.pagination?.page);
  const pageSize = normalizePageSize(request.pagination?.pageSize);
  const url = new URL(
    "/buy/browse/v1/item_summary/search",
    `${apiBaseUrl}/`,
  );
  const queryText = toTrimmedString(request.query.text) || defaultQuery;
  url.searchParams.set("q", queryText);
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("offset", String((page - 1) * pageSize));

  const sort = mapSort(request.query.sort);

  if (sort) {
    url.searchParams.set("sort", sort);
  }

  const filters: string[] = [];
  const price = request.query.price;

  if (price && (price.min !== undefined || price.max !== undefined)) {
    const minimum = price.min ?? "";
    const maximum = price.max ?? "";
    const currency = toTrimmedString(
      price.currency ?? request.query.currency,
    ).toUpperCase();
    filters.push(`price:[${minimum}..${maximum}]`);
    filters.push(`priceCurrency:${currency}`);
  }

  if (request.query.listingTypes?.length) {
    const buyingOptions = request.query.listingTypes.map((listingType) =>
      listingType === "auction" ? "AUCTION" : "FIXED_PRICE",
    );
    filters.push(`buyingOptions:{${buyingOptions.join("|")}}`);
  }

  if (filters.length > 0) {
    url.searchParams.set("filter", filters.join(","));
  }

  return {
    page,
    pageSize,
    url: url.toString(),
  };
}

function createAffiliateHeader(options: EbayProviderOptions) {
  const campaignId = toTrimmedString(options.affiliateCampaignId);

  if (!campaignId) {
    return undefined;
  }

  const referenceId = toTrimmedString(options.affiliateReferenceId);
  return [
    `affiliateCampaignId=${campaignId}`,
    referenceId ? `affiliateReferenceId=${referenceId}` : undefined,
  ]
    .filter(Boolean)
    .join(",");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toHttpFailure(error: unknown): ProviderSearchFailure {
  if (error instanceof ProviderHttpError) {
    return createFailure(error.code, error.message, {
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      statusCode: error.statusCode,
    });
  }

  return createFailure(
    "unavailable",
    error instanceof Error
      ? error.message
      : "eBay Browse failed before receiving a response.",
    { retryable: false },
  );
}

export function createEbayProvider(options: EbayProviderOptions = {}): Provider {
  const clientId = toTrimmedString(options.clientId);
  const clientSecret = toTrimmedString(options.clientSecret);
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl, defaultApiBaseUrl);
  const identityBaseUrl = normalizeBaseUrl(
    options.identityBaseUrl,
    defaultIdentityBaseUrl,
  );
  const marketplaceId =
    toTrimmedString(options.marketplaceId) || defaultMarketplaceId;
  const oauthScope = toTrimmedString(options.oauthScope) || defaultOAuthScope;
  const defaultQuery =
    toTrimmedString(options.defaultSearchQuery) || defaultSearchQuery;
  const nowImpl = options.nowImpl ?? (() => Date.now());
  const httpClient = options.fetchImpl
    ? createResilientHttpClient({
        baseBackoffMs: options.baseBackoffMs,
        circuitBreakerCooldownMs: options.circuitBreakerCooldownMs,
        circuitBreakerFailureThreshold:
          options.circuitBreakerFailureThreshold,
        fetchImpl: options.fetchImpl,
        maxConcurrency: options.maxConcurrency,
        maxRetries: options.maxRetries,
        minRequestIntervalMs: options.minRequestIntervalMs,
        nowImpl,
        onMetric: options.onHttpMetric,
        requestTimeoutMs: options.requestTimeoutMs,
        sleepImpl: options.sleepImpl,
      })
    : undefined;
  let tokenCache: CachedToken | undefined;
  let tokenRequest: Promise<CachedToken> | undefined;

  async function requestToken(forceRefresh = false) {
    if (forceRefresh) {
      tokenCache = undefined;
    }

    if (tokenCache && tokenCache.expiresAt > nowImpl()) {
      return tokenCache.accessToken;
    }

    if (tokenRequest) {
      return (await tokenRequest).accessToken;
    }

    if (!httpClient) {
      throw new ProviderHttpError(
        "eBay Browse is configured without a server-side HTTP implementation.",
        {
          code: "unavailable",
          retryable: false,
        },
      );
    }

    tokenRequest = (async () => {
      let basicCredentials: string;

      try {
        basicCredentials = btoa(`${clientId}:${clientSecret}`);
      } catch {
        throw new ProviderHttpError(
          "eBay OAuth client credentials must use a valid basic-auth encoding.",
          {
            code: "missing_credentials",
            retryable: false,
          },
        );
      }

      const body = new URLSearchParams({
        grant_type: "client_credentials",
        scope: oauthScope,
      }).toString();
      const response = await httpClient.request({
        operation: "ebay_oauth_token",
        url: `${identityBaseUrl}/identity/v1/oauth2/token`,
        method: "POST",
        body,
        headers: {
          accept: "application/json",
          authorization: `Basic ${basicCredentials}`,
          "content-type": "application/x-www-form-urlencoded",
        },
      });

      if (response.status === 401) {
        throw new ProviderHttpError(
          "eBay rejected the configured OAuth client credentials.",
          {
            code: "missing_credentials",
            retryable: false,
            statusCode: response.status,
          },
        );
      }

      if (response.status === 403) {
        throw new ProviderHttpError(
          "eBay has not authorized this application for the requested API scope.",
          {
            code: "authorization_required",
            retryable: false,
            statusCode: response.status,
          },
        );
      }

      if (!response.ok) {
        throw new ProviderHttpError(
          `eBay OAuth failed with status ${response.status}.`,
          {
            code: response.status === 400 ? "missing_credentials" : "unavailable",
            retryable: false,
            statusCode: response.status,
          },
        );
      }

      const payload = await parseJsonResponse<EbayRawOAuthResponse>(response);
      const accessToken = toTrimmedString(payload.access_token);
      const expiresIn =
        typeof payload.expires_in === "number" &&
        Number.isFinite(payload.expires_in) &&
        payload.expires_in > 0
          ? payload.expires_in
          : 0;

      if (!accessToken || !expiresIn) {
        throw new ProviderHttpError(
          "eBay OAuth returned an invalid access-token payload.",
          {
            code: "invalid_response",
            retryable: false,
            statusCode: response.status,
          },
        );
      }

      const cachedToken = {
        accessToken,
        expiresAt: nowImpl() + Math.max(1, expiresIn - 60) * 1_000,
      };
      tokenCache = cachedToken;
      return cachedToken;
    })();

    try {
      return (await tokenRequest).accessToken;
    } finally {
      tokenRequest = undefined;
    }
  }

  async function requestBrowse(
    request: ProviderSearchRequest,
    accessToken: string,
  ) {
    if (!httpClient) {
      throw new ProviderHttpError(
        "eBay Browse is configured without a server-side HTTP implementation.",
        {
          code: "unavailable",
          retryable: false,
        },
      );
    }

    const searchRequest = buildSearchUrl(apiBaseUrl, request, defaultQuery);
    const affiliateHeader = createAffiliateHeader(options);
    const response = await httpClient.request({
      operation: "ebay_browse_search",
      url: searchRequest.url,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "x-ebay-c-marketplace-id": marketplaceId,
        ...(affiliateHeader
          ? { "x-ebay-c-enduserctx": affiliateHeader }
          : {}),
      },
    });

    return {
      ...searchRequest,
      response,
    };
  }

  return {
    id: ebayProviderId,
    name: ebayProviderName,
    dataOrigin: "official_api",
    isMock: false,
    capabilities: ebayProviderCapabilities,
    async search(request): Promise<ProviderSearchResponse> {
      const startedAt = nowImpl();

      if (!clientId || !clientSecret) {
        return createFailure(
          "missing_credentials",
          "eBay Browse requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.",
        );
      }

      if (!options.fetchImpl) {
        return createFailure(
          "unavailable",
          "eBay Browse is configured without a server-side HTTP implementation.",
        );
      }

      if (
        request.query.sourceIds?.length &&
        !request.query.sourceIds.includes(ebayProviderId)
      ) {
        const page = normalizePage(request.pagination?.page);
        const pageSize = normalizePageSize(request.pagination?.pageSize);
        return createSuccess(
          [],
          { page, pageSize, hasMore: false, totalCount: 0 },
          {
            fetchedAt: new Date(nowImpl()).toISOString(),
            latencyMs: Math.max(0, nowImpl() - startedAt),
          },
        );
      }

      const validationFailure = validateQuery(request);

      if (validationFailure) {
        return validationFailure;
      }

      try {
        let accessToken = await requestToken();
        let browse = await requestBrowse(request, accessToken);

        if (browse.response.status === 401) {
          accessToken = await requestToken(true);
          browse = await requestBrowse(request, accessToken);
        }

        if (browse.response.status === 401) {
          return createFailure(
            "missing_credentials",
            "eBay rejected the application access token after one refresh.",
            { statusCode: browse.response.status },
          );
        }

        if (browse.response.status === 403) {
          return createFailure(
            "authorization_required",
            "eBay has not approved this application for production Browse API access.",
            { statusCode: browse.response.status },
          );
        }

        if (browse.response.status === 400 || browse.response.status === 422) {
          return createFailure(
            "invalid_query",
            `eBay Browse rejected the normalized query with status ${browse.response.status}.`,
            { statusCode: browse.response.status },
          );
        }

        if (!browse.response.ok) {
          return createFailure(
            "unavailable",
            `eBay Browse failed with status ${browse.response.status}.`,
            {
              retryable: browse.response.status >= 500,
              statusCode: browse.response.status,
            },
          );
        }

        const payload = await parseJsonResponse<EbayRawBrowseResponse>(
          browse.response,
        );
        const fetchedAt = new Date(nowImpl()).toISOString();
        const rawItems = Array.isArray(payload.itemSummaries)
          ? payload.itemSummaries
          : [];
        const listings = rawItems
          .filter(isRecord)
          .map((item) =>
            normalizeEbayItemSummary(
              item as unknown as EbayRawItemSummary,
              fetchedAt,
            ),
          )
          .filter((listing): listing is NonNullable<typeof listing> =>
            listing !== null
          );
        const warnings: ProviderWarning[] = [];
        const droppedCount = rawItems.length - listings.length;

        if (droppedCount > 0) {
          warnings.push({
            code: "malformed_items_dropped",
            message: `Dropped ${droppedCount} malformed or unavailable eBay item summaries.`,
            severity: "warning",
          });
        }

        for (const warning of payload.warnings ?? []) {
          const message =
            toTrimmedString(warning.message) ||
            toTrimmedString(warning.longMessage);

          if (message) {
            warnings.push({
              code: `ebay_${warning.errorId ?? "warning"}`,
              message,
              severity: "warning",
            });
          }
        }

        const totalCount =
          typeof payload.total === "number" &&
          Number.isSafeInteger(payload.total) &&
          payload.total >= 0
            ? payload.total
            : undefined;
        const rawOffset =
          typeof payload.offset === "number" &&
          Number.isSafeInteger(payload.offset) &&
          payload.offset >= 0
            ? payload.offset
            : (browse.page - 1) * browse.pageSize;
        const hasMore =
          Boolean(toTrimmedString(payload.next)) ||
          (totalCount !== undefined &&
            rawOffset + rawItems.length < totalCount);
        const pagination = {
          page: browse.page,
          pageSize: browse.pageSize,
          hasMore,
          nextPage: hasMore ? browse.page + 1 : undefined,
          totalCount,
        };

        return createSuccess(
          listings,
          pagination,
          {
            fetchedAt,
            latencyMs: Math.max(0, nowImpl() - startedAt),
          },
          warnings.length > 0 ? warnings : undefined,
        );
      } catch (error) {
        return toHttpFailure(error);
      }
    },
  };
}
