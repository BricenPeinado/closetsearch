import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type {
  FeedQuery,
  Listing,
  ListingCondition,
  ListingMarketStatus,
  ListingType,
  OnboardingPreferences,
  SearchQuery,
  SearchSortMode,
} from "@closetsearch/shared";
import { isApiError } from "./api-error.js";
import { getAuthConfig } from "./auth/config.js";
import {
  getAuthSessionResolution,
  getOptionalAuthContext,
  requireAuth,
} from "./auth/auth-context.js";
import { prepareRequestAuthContext } from "./auth/postgres-session-service.js";
import {
  clearSessionCookie,
  createAuthSession,
  revokeAllSessionsForUser,
  revokeCurrentSession,
} from "./auth/session-service.js";
import { getFeed } from "./feed-service.js";
import { addLike, getLikedListingsByUserId, getLikesByUserId, removeLike } from "./like-service.js";
import { createRequestId, logError, logWarn } from "./logger.js";
import { parseJsonRequestBody } from "./http/request-body.js";
import { FixedWindowRateLimiter, getRequestIpHint } from "./http/rate-limit.js";
import { assertCsrfSafeRequest, buildSecurityHeaders } from "./http/security.js";
import { incrementCounter } from "./metrics.js";
import {
  addRecentSearch,
  getRecentSearchesByUserId,
  removeRecentSearchesByUserId,
} from "./recent-search-service.js";
import {
  addSavedSearch,
  getSavedSearchesByUserId,
  removeSavedSearch,
} from "./saved-search-service.js";
import { addSavedFilter, getSavedFiltersByUserId, removeSavedFilter } from "./saved-filter-service.js";
import { searchListings } from "./search-service.js";
import { getSettingsByUserId, updateSettings } from "./user-settings-service.js";
import { createUser, loginUser, saveOnboardingPreferences } from "./user-service.js";
import {
  getAlertMatchesByUserId,
} from "./services/alertMatchService.js";
import {
  getAlertPreferencesByUserId,
  updateAlertPreferences,
} from "./services/alertPreferenceService.js";
import {
  createWatchlist,
  getWatchlistsByUserId,
  removeWatchlist,
  updateWatchlist,
} from "./services/watchlistService.js";
import { handleEngagementRoute } from "./routes/engagement-routes.js";
import { handleOperationsRoute } from "./routes/operations-routes.js";
import { handleBrandRoute } from "./routes/brand-routes.js";
import { handleAnalyticsRoute } from "./routes/analytics-routes.js";
import { handleEntitlementRoute } from "./routes/entitlement-routes.js";
import { handlePostgresAccountRoute } from "./routes/postgres-account-routes.js";
import { handlePostgresAuthRoute } from "./routes/postgres-auth-routes.js";
import { handlePostgresSavedRoute } from "./routes/postgres-saved-routes.js";

const requestIdHeaderName = "x-request-id";
const authRateLimiter = new FixedWindowRateLimiter({
  limit: 10,
  windowMs: 60_000,
});

export function resetHttpSecurityStateForTests() {
  authRateLimiter.reset();
}

function buildCorsHeaders(request: IncomingMessage) {
  const origin =
    typeof request.headers?.origin === "string" ? request.headers.origin.trim() : "";
  const authConfig = getAuthConfig();
  const headers: Record<string, string> = {
    "access-control-allow-headers":
      "content-type,x-privacy-session-id",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  };

  if (origin && authConfig.allowedOrigins.has(origin)) {
    headers["access-control-allow-credentials"] = "true";
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }

  return headers;
}

function getRequestId(request: IncomingMessage) {
  return (request as IncomingMessage & { __requestId?: string }).__requestId ?? "unknown";
}

function buildResponseHeaders(
  request: IncomingMessage,
  extraHeaders?: Record<string, string>,
) {
  return {
    ...buildSecurityHeaders(),
    ...buildCorsHeaders(request),
    [requestIdHeaderName]: getRequestId(request),
    ...extraHeaders,
  };
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
) {
  response.writeHead(statusCode, {
    ...buildResponseHeaders(request, extraHeaders),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  extraHeaders?: Record<string, string>,
) {
  response.writeHead(statusCode, {
    ...buildResponseHeaders(request, extraHeaders),
  });
  response.end();
}

const parseJsonBody = parseJsonRequestBody;

function parseListParameter(value: string | null) {
  if (!value) {
    return undefined;
  }

  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function parseSearchSortMode(value: string | null): SearchSortMode {
  switch (value) {
    case "price_asc":
    case "price_desc":
    case "newest":
    case "relevance":
      return value;
    default:
      return "relevance";
  }
}

function parseListingMarketStatus(
  value: string | null,
): ListingMarketStatus | undefined {
  switch (value?.trim().toLowerCase()) {
    case "active":
      return "active";
    case "sold":
      return "sold";
    default:
      return undefined;
  }
}

function parseListingTypes(value: string | null): ListingType[] | undefined {
  const listingTypes = parseListParameter(value)
    ?.map((item) => {
      if (item === "fixed_price") {
        return "buy_now";
      }

      if (item === "auction" || item === "buy_now" || item === "unknown") {
        return item;
      }

      return undefined;
    })
    .filter((item): item is ListingType => item !== undefined);

  return listingTypes && listingTypes.length > 0 ? listingTypes : undefined;
}

function parseListingConditions(
  value: string | null,
): ListingCondition[] | undefined {
  const conditions = parseListParameter(value)
    ?.map((item) => toOptionalListingCondition(item))
    .filter(
      (condition): condition is ListingCondition => condition !== undefined,
    );

  return conditions && conditions.length > 0 ? conditions : undefined;
}

function parsePositiveInteger(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return parsedValue;
}

function hasSearchCriteria(requestUrl: URL) {
  const searchParams = requestUrl.searchParams;

  return (
    (searchParams.get("q")?.trim().length ?? 0) > 0 ||
    (searchParams.get("source")?.trim().length ?? 0) > 0 ||
    (searchParams.get("sources")?.trim().length ?? 0) > 0 ||
    (searchParams.get("listingType")?.trim().length ?? 0) > 0 ||
    (searchParams.get("listingTypes")?.trim().length ?? 0) > 0 ||
    (searchParams.get("minPrice")?.trim().length ?? 0) > 0 ||
    (searchParams.get("maxPrice")?.trim().length ?? 0) > 0 ||
    (searchParams.get("marketScope")?.trim().length ?? 0) > 0 ||
    (searchParams.get("market")?.trim().length ?? 0) > 0 ||
    (searchParams.get("brands")?.trim().length ?? 0) > 0 ||
    (searchParams.get("categories")?.trim().length ?? 0) > 0 ||
    (searchParams.get("sizes")?.trim().length ?? 0) > 0 ||
    (searchParams.get("conditions")?.trim().length ?? 0) > 0 ||
    (searchParams.get("currency")?.trim().length ?? 0) > 0 ||
    parseSearchSortMode(searchParams.get("sort")) !== "relevance"
  );
}

function parseSearchQuery(requestUrl: URL): SearchQuery | null {
  const text = requestUrl.searchParams.get("q")?.trim() ?? "";

  if (!hasSearchCriteria(requestUrl)) {
    return null;
  }

  const minPrice = requestUrl.searchParams.get("minPrice");
  const maxPrice = requestUrl.searchParams.get("maxPrice");
  const parsedMinPrice = minPrice ? Number(minPrice) : undefined;
  const parsedMaxPrice = maxPrice ? Number(maxPrice) : undefined;
  const page = parsePositiveInteger(requestUrl.searchParams.get("page"), 1);
  const pageSize = parsePositiveInteger(requestUrl.searchParams.get("pageSize"), 24);

  return {
    text,
    brandSlugs: parseListParameter(requestUrl.searchParams.get("brands")),
    categories: parseListParameter(requestUrl.searchParams.get("categories")),
    sizes: parseListParameter(requestUrl.searchParams.get("sizes")),
    conditions: parseListingConditions(
      requestUrl.searchParams.get("conditions"),
    ),
    sourceIds:
      parseListParameter(requestUrl.searchParams.get("source")) ??
      parseListParameter(requestUrl.searchParams.get("sources")),
    listingTypes: parseListingTypes(
      requestUrl.searchParams.get("listingType") ??
        requestUrl.searchParams.get("listingTypes"),
    ),
    marketScope: parseListingMarketStatus(
      requestUrl.searchParams.get("marketScope") ??
        requestUrl.searchParams.get("market"),
    ),
    sort: parseSearchSortMode(requestUrl.searchParams.get("sort")),
    currency: requestUrl.searchParams.get("currency") ?? undefined,
    cursor: requestUrl.searchParams.get("cursor") ?? undefined,
    page,
    pageSize: Math.min(pageSize, 48),
    price:
      parsedMinPrice !== undefined || parsedMaxPrice !== undefined
        ? {
            min: Number.isFinite(parsedMinPrice) ? parsedMinPrice : undefined,
            max: Number.isFinite(parsedMaxPrice) ? parsedMaxPrice : undefined,
            currency: requestUrl.searchParams.get("currency") ?? undefined,
          }
        : undefined,
  };
}

function parseFeedQuery(requestUrl: URL): FeedQuery {
  const page = parsePositiveInteger(requestUrl.searchParams.get("page"), 1);
  const requestedPageSize = parsePositiveInteger(
    requestUrl.searchParams.get("pageSize"),
    12,
  );
  const debugPersonalizationValue = requestUrl.searchParams.get("debugPersonalization");

  return {
    cursor: requestUrl.searchParams.get("cursor") ?? undefined,
    debugPersonalization:
      debugPersonalizationValue === "1" ||
      debugPersonalizationValue?.trim().toLowerCase() === "true",
    page,
    pageSize: Math.min(requestedPageSize, 24),
  };
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}


function toOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? Math.max(0, Math.trunc(parsedValue)) : undefined;
  }

  return undefined;
}

function toOptionalSearchSortMode(value: unknown) {
  if (value === "price_asc" || value === "price_desc" || value === "newest" || value === "relevance") {
    return value;
  }

  return undefined;
}

function toOptionalSavedFilterListingType(value: unknown): "auction" | "buy_now" | undefined {
  if (value === "auction" || value === "buy_now") {
    return value;
  }

  if (value === "fixed_price") {
    return "buy_now";
  }

  return undefined;
}

function toOptionalBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === "true") {
      return true;
    }

    if (normalizedValue === "false") {
      return false;
    }
  }

  return undefined;
}

function toOptionalListingCondition(value: unknown): ListingCondition | undefined {
  switch (value) {
    case "new_with_tags":
    case "new_without_tags":
    case "excellent":
    case "good":
    case "fair":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

function toOptionalAlertFrequency(value: unknown) {
  if (value === "instant" || value === "daily" || value === "weekly") {
    return value;
  }

  return undefined;
}

function getPathId(pathname: string, basePath: string) {
  if (!pathname.startsWith(basePath + "/")) {
    return undefined;
  }

  const rawValue = decodeURIComponent(pathname.slice(basePath.length + 1)).trim();
  return rawValue || undefined;
}

function toOptionalListingSnapshot(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const listing = value as Listing;

  if (
    typeof listing.id !== "string" ||
    typeof listing.providerId !== "string" ||
    typeof listing.providerListingId !== "string" ||
    typeof listing.sourceUrl !== "string" ||
    typeof listing.title !== "string" ||
    !listing.source ||
    typeof listing.source.id !== "string" ||
    typeof listing.source.name !== "string" ||
    !listing.brand ||
    typeof listing.brand.id !== "string" ||
    typeof listing.brand.slug !== "string" ||
    typeof listing.brand.name !== "string" ||
    typeof listing.imageUrl !== "string" ||
    !listing.price ||
    typeof listing.price.amount !== "number" ||
    typeof listing.price.currency !== "string" ||
    typeof listing.listingType !== "string" ||
    typeof listing.fetchedAt !== "string"
  ) {
    return undefined;
  }

  return listing;
}

function toOnboardingPreferences(value: unknown): OnboardingPreferences {
  const preferences =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    favoriteBrands: toStringArray(preferences.favoriteBrands),
    categories: toStringArray(preferences.categories),
    priceRange: toTrimmedString(preferences.priceRange),
  };
}

function sendValidationError(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  message: string,
  statusCode = 400,
  error = "invalid_request",
) {
  sendJson(request, response, statusCode, {
    error,
    message,
  });
}

async function handleSignup(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  authRateLimiter.consume(`signup:${getRequestIpHint(request)}`);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const username = toTrimmedString(body?.username);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || !password) {
    sendValidationError(request, response, "Username and password are required.");
    return;
  }

  const authResponse = createUser(username, password);
  const authSession = createAuthSession(authResponse.userId, request);

  sendJson(request, response, 201, authResponse, {
    "cache-control": "no-store",
    "set-cookie": authSession.cookieValue,
  });
}

async function handleLogin(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  authRateLimiter.consume(`login:${getRequestIpHint(request)}`);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const username = toTrimmedString(body?.username);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || !password) {
    sendValidationError(request, response, "Username and password are required.");
    return;
  }

  const authResponse = loginUser(username, password);
  const authSession = createAuthSession(authResponse.userId, request);

  sendJson(request, response, 200, authResponse, {
    "cache-control": "no-store",
    "set-cookie": authSession.cookieValue,
  });
}

function handleAuthMe(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const authSession = getAuthSessionResolution(request);

  if (authSession.status !== "authenticated") {
    sendJson(
      request,
      response,
      401,
      {
        error: authSession.status === "missing" ? "unauthenticated" : "session_expired",
        message:
          authSession.status === "missing"
            ? "You are not logged in."
            : "Your session has expired. Please log in again.",
      },
      authSession.status === "session_expired"
        ? {
            "cache-control": "no-store",
            "set-cookie": clearSessionCookie(),
          }
        : {
            "cache-control": "no-store",
          },
    );
    return;
  }

  sendJson(
    request,
    response,
    200,
    {
      user: authSession.user,
      userId: authSession.user.id,
    },
    {
      "cache-control": "no-store",
    },
  );
}

function handleLogout(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  revokeCurrentSession(request);

  sendJson(
    request,
    response,
    200,
    {
      success: true,
    },
    {
      "cache-control": "no-store",
      "set-cookie": clearSessionCookie(),
    },
  );
}

function handleLogoutAll(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const revokedSessions = revokeAllSessionsForUser(user.id);

  sendJson(
    request,
    response,
    200,
    {
      revokedSessions,
      success: true,
    },
    {
      "cache-control": "no-store",
      "set-cookie": clearSessionCookie(),
    },
  );
}

async function handleOnboarding(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;

  sendJson(
    request,
    response,
    200,
    saveOnboardingPreferences(
      user.id,
      toOnboardingPreferences(body?.preferences),
      toTrimmedString(body?.currencyPreference) || undefined,
    ),
    {
      "cache-control": "no-store",
    },
  );
}

async function handleCreateLike(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const listingId = toTrimmedString(body?.listingId);
  const source = toTrimmedString(body?.source);

  if (!listingId || !source) {
    sendValidationError(request, response, "listingId and source are required.");
    return;
  }

  const likedListing = addLike({
    userId: user.id,
    listingId,
    source,
    listing: toOptionalListingSnapshot(body?.listing),
  });

  sendJson(request, response, 201, {
    likedListing,
    userId: user.id,
  });
}

async function handleDeleteLike(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const id = toTrimmedString(body?.id);
  const listingId = toTrimmedString(body?.listingId);

  if (!id && !listingId) {
    sendValidationError(request, response, "Either id or listingId is required.");
    return;
  }

  sendJson(request, response, 200, {
    removed: removeLike({
      userId: user.id,
      id: id || undefined,
      listingId: listingId || undefined,
    }),
    userId: user.id,
  });
}

function handleGetLikes(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);

  sendJson(request, response, 200, {
    likedListings: getLikedListingsByUserId(user.id),
    likes: getLikesByUserId(user.id),
    userId: user.id,
  });
}

async function handleCreateRecentSearch(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const label = toTrimmedString(body?.label);
  const description = toTrimmedString(body?.description);
  const params = toTrimmedString(body?.params);

  if (!label || !description || !params) {
    sendValidationError(request, response, "label, description, and params are required.");
    return;
  }

  const recentSearch = addRecentSearch({
    userId: user.id,
    label,
    description,
    params,
  });

  sendJson(request, response, 201, {
    recentSearch,
    recentSearches: getRecentSearchesByUserId(user.id),
    userId: user.id,
  });
}

function handleGetRecentSearches(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);

  sendJson(request, response, 200, {
    recentSearches: getRecentSearchesByUserId(user.id),
    userId: user.id,
  });
}

function handleDeleteRecentSearches(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);

  removeRecentSearchesByUserId(user.id);

  sendJson(request, response, 200, {
    cleared: true,
    userId: user.id,
  });
}

async function handleCreateSavedSearch(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const label = toTrimmedString(body?.label);
  const description = toTrimmedString(body?.description);
  const params = toTrimmedString(body?.params);

  if (!label || !description || !params) {
    sendValidationError(request, response, "label, description, and params are required.");
    return;
  }

  const savedSearch = addSavedSearch({
    userId: user.id,
    label,
    description,
    params,
  });

  sendJson(request, response, 201, {
    savedSearch,
    savedSearches: getSavedSearchesByUserId(user.id),
    userId: user.id,
  });
}

function handleGetSavedSearches(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);

  sendJson(request, response, 200, {
    savedSearches: getSavedSearchesByUserId(user.id),
    userId: user.id,
  });
}

async function handleDeleteSavedSearch(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const id = toTrimmedString(body?.id);
  const params = toTrimmedString(body?.params);

  if (!id && !params) {
    sendValidationError(request, response, "Either id or params is required.");
    return;
  }

  sendJson(request, response, 200, {
    removed: removeSavedSearch({
      userId: user.id,
      id: id || undefined,
      params: params || undefined,
    }),
    userId: user.id,
  });
}

async function handleCreateSavedFilter(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const label = toTrimmedString(body?.label);

  if (!label) {
    sendValidationError(request, response, "label is required.");
    return;
  }

  const savedFilter = addSavedFilter({
    userId: user.id,
    label,
    queryText: toTrimmedString(body?.queryText) || undefined,
    source: toTrimmedString(body?.source) || undefined,
    listingType: toOptionalSavedFilterListingType(body?.listingType),
    minPrice: toOptionalNumber(body?.minPrice),
    maxPrice: toOptionalNumber(body?.maxPrice),
    sortMode: toOptionalSearchSortMode(body?.sortMode),
  });

  sendJson(request, response, 201, {
    savedFilter,
    savedFilters: getSavedFiltersByUserId(user.id),
    userId: user.id,
  });
}

function handleGetSavedFilters(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);

  sendJson(request, response, 200, {
    savedFilters: getSavedFiltersByUserId(user.id),
    userId: user.id,
  });
}

async function handleDeleteSavedFilter(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const id = toTrimmedString(body?.id);

  if (!id) {
    sendValidationError(request, response, "id is required.");
    return;
  }

  sendJson(request, response, 200, {
    removed: removeSavedFilter({
      userId: user.id,
      id,
    }),
    userId: user.id,
  });
}

function buildWatchlistInput(body: Record<string, unknown> | null) {
  return {
    label: toTrimmedString(body?.label) || undefined,
    queryText: toTrimmedString(body?.queryText) || undefined,
    brand: toTrimmedString(body?.brand) || undefined,
    category: toTrimmedString(body?.category) || undefined,
    source: toTrimmedString(body?.source) || undefined,
    listingType: toOptionalSavedFilterListingType(body?.listingType),
    minPriceAmount: toOptionalNumber(body?.minPriceAmount ?? body?.minPrice),
    maxPriceAmount: toOptionalNumber(body?.maxPriceAmount ?? body?.maxPrice),
    priceCurrency: toTrimmedString(body?.priceCurrency) || undefined,
    condition: toOptionalListingCondition(body?.condition),
    size: toTrimmedString(body?.size) || undefined,
    enabled: toOptionalBoolean(body?.enabled),
  };
}

async function handleCreateWatchlist(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;

  const watchlist = createWatchlist({
    userId: user.id,
    ...buildWatchlistInput(body),
  });

  sendJson(request, response, 201, {
    watchlist,
    watchlists: getWatchlistsByUserId(user.id),
    userId: user.id,
  });
}

function handleGetWatchlists(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);

  sendJson(request, response, 200, {
    watchlists: getWatchlistsByUserId(user.id),
    userId: user.id,
  });
}

async function handlePatchWatchlist(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  watchlistId: string,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;

  const watchlist = updateWatchlist({
    id: watchlistId,
    userId: user.id,
    ...buildWatchlistInput(body),
  });

  sendJson(request, response, 200, {
    watchlist,
    watchlists: getWatchlistsByUserId(user.id),
    userId: user.id,
  });
}

async function handleDeleteWatchlist(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  watchlistId?: string,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const id = watchlistId ?? toTrimmedString(body?.id);

  if (!id) {
    sendValidationError(request, response, "id is required.");
    return;
  }

  sendJson(request, response, 200, {
    removed: removeWatchlist({
      userId: user.id,
      id,
    }),
    userId: user.id,
  });
}

function handleGetNotificationPreferences(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);

  sendJson(request, response, 200, {
    notificationPreferences: getAlertPreferencesByUserId(user.id),
    userId: user.id,
  });
}

async function handlePatchNotificationPreferences(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;

  const notificationPreferences = updateAlertPreferences({
    userId: user.id,
    emailEnabled: toOptionalBoolean(body?.emailEnabled),
    pushEnabled: toOptionalBoolean(body?.pushEnabled),
    smsEnabled: toOptionalBoolean(body?.smsEnabled),
    inAppEnabled: toOptionalBoolean(body?.inAppEnabled),
    frequency: toOptionalAlertFrequency(body?.frequency),
    quietHoursStart:
      body?.quietHoursStart === null ? null : toTrimmedString(body?.quietHoursStart) || undefined,
    quietHoursEnd:
      body?.quietHoursEnd === null ? null : toTrimmedString(body?.quietHoursEnd) || undefined,
  });

  sendJson(request, response, 200, {
    notificationPreferences,
    userId: user.id,
  });
}

function handleGetAlertMatches(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);

  sendJson(request, response, 200, {
    alertMatches: getAlertMatchesByUserId(user.id),
    deliveryActive: false,
    message: "Alert delivery is not active yet. Stored matches are foundation data only.",
    userId: user.id,
  });
}

function handleGetSettings(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);

  sendJson(request, response, 200, {
    settings: getSettingsByUserId(user.id),
    userId: user.id,
  });
}

async function handlePatchSettings(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = requireAuth(request);
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;

  const settings = updateSettings({
    userId: user.id,
    preferredCurrency: toTrimmedString(body?.preferredCurrency) || undefined,
    defaultSortMode:
      body && Object.prototype.hasOwnProperty.call(body, "defaultSortMode")
        ? body.defaultSortMode === null
          ? null
          : toOptionalSearchSortMode(body.defaultSortMode)
        : undefined,
    preferredSources:
      body && Object.prototype.hasOwnProperty.call(body, "preferredSources")
        ? toStringArray(body.preferredSources)
        : undefined,
    displayName:
      body && Object.prototype.hasOwnProperty.call(body, "displayName")
        ? body.displayName === null
          ? null
          : toTrimmedString(body.displayName) || null
        : undefined,
  });

  sendJson(request, response, 200, {
    settings,
    userId: user.id,
  });
}

function getErrorHeaders(error: { code?: string }) {
  if (error.code === "session_expired" || error.code === "unauthenticated") {
    return {
      "cache-control": "no-store",
      "set-cookie": clearSessionCookie(),
    };
  }

  return undefined;
}

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (method === "OPTIONS") {
    sendEmpty(request, response, 204);
    return;
  }

  await prepareRequestAuthContext(request);

  assertCsrfSafeRequest(request);

  const postgresAuthRoute = await handlePostgresAuthRoute(
    request,
    requestUrl,
  );

  if (postgresAuthRoute) {
    sendJson(
      request,
      response,
      postgresAuthRoute.statusCode,
      postgresAuthRoute.body,
      postgresAuthRoute.headers,
    );
    return;
  }

  const postgresAccountRoute = await handlePostgresAccountRoute(
    request,
    requestUrl,
  );

  if (postgresAccountRoute) {
    sendJson(
      request,
      response,
      postgresAccountRoute.statusCode,
      postgresAccountRoute.body,
      postgresAccountRoute.headers,
    );
    return;
  }

  const postgresSavedRoute = await handlePostgresSavedRoute(
    request,
    requestUrl,
  );

  if (postgresSavedRoute) {
    sendJson(
      request,
      response,
      postgresSavedRoute.statusCode,
      postgresSavedRoute.body,
      postgresSavedRoute.headers,
    );
    return;
  }

  const engagementRoute = await handleEngagementRoute(request, requestUrl);

  if (engagementRoute) {
    sendJson(
      request,
      response,
      engagementRoute.statusCode,
      engagementRoute.body,
    );
    return;
  }

  const entitlementRoute = await handleEntitlementRoute(request, requestUrl);

  if (entitlementRoute) {
    sendJson(
      request,
      response,
      entitlementRoute.statusCode,
      entitlementRoute.body,
      entitlementRoute.headers,
    );
    return;
  }

  const operationsRoute = await handleOperationsRoute(request, requestUrl);

  if (operationsRoute) {
    if (operationsRoute.kind === "json") {
      sendJson(
        request,
        response,
        operationsRoute.statusCode,
        operationsRoute.body,
        operationsRoute.headers,
      );
    } else {
      response.writeHead(operationsRoute.statusCode, {
        ...buildResponseHeaders(request),
        ...operationsRoute.headers,
      });
      response.end(operationsRoute.body);
    }
    return;
  }

  if (method === "POST" && requestUrl.pathname === "/auth/signup") {
    await handleSignup(request, response);
    return;
  }

  if (method === "POST" && requestUrl.pathname === "/auth/login") {
    await handleLogin(request, response);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/auth/me") {
    handleAuthMe(request, response);
    return;
  }

  if (method === "POST" && requestUrl.pathname === "/auth/logout") {
    handleLogout(request, response);
    return;
  }

  if (method === "POST" && requestUrl.pathname === "/auth/logout-all") {
    handleLogoutAll(request, response);
    return;
  }

  if (method === "POST" && requestUrl.pathname === "/users/onboarding") {
    await handleOnboarding(request, response);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/search") {
    const query = parseSearchQuery(requestUrl);

    if (!query) {
      sendJson(request, response, 400, {
        error: "invalid_query",
        message: "At least one search query or filter parameter is required.",
      });
      return;
    }

    const result = await searchListings(query);

    sendJson(request, response, 200, result);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/feed") {
    const result = await getFeed({
      ...parseFeedQuery(requestUrl),
      userId: getOptionalAuthContext(request)?.user.id,
    });

    sendJson(request, response, 200, result);
    return;
  }

  const analyticsRoute = await handleAnalyticsRoute(request, requestUrl);

  if (analyticsRoute) {
    sendJson(
      request,
      response,
      analyticsRoute.statusCode,
      analyticsRoute.body,
      analyticsRoute.headers,
    );
    return;
  }

  const brandRoute = handleBrandRoute(request, requestUrl);

  if (brandRoute) {
    sendJson(
      request,
      response,
      brandRoute.statusCode,
      brandRoute.body,
      brandRoute.headers,
    );
    return;
  }

  if (method === "POST" && (requestUrl.pathname === "/likes" || requestUrl.pathname === "/me/likes")) {
    await handleCreateLike(request, response);
    return;
  }

  if (method === "DELETE" && (requestUrl.pathname === "/likes" || requestUrl.pathname === "/me/likes")) {
    await handleDeleteLike(request, response);
    return;
  }

  if (
    method === "GET" &&
    (
      requestUrl.pathname === "/likes" ||
      requestUrl.pathname.startsWith("/likes/") ||
      requestUrl.pathname === "/me/likes" ||
      requestUrl.pathname.startsWith("/me/likes/")
    )
  ) {
    handleGetLikes(request, response);
    return;
  }

  if (method === "POST" && requestUrl.pathname === "/recent-searches") {
    await handleCreateRecentSearch(request, response);
    return;
  }

  if (
    method === "GET" &&
    (requestUrl.pathname === "/recent-searches" ||
      requestUrl.pathname.startsWith("/recent-searches/"))
  ) {
    handleGetRecentSearches(request, response);
    return;
  }

  if (
    method === "DELETE" &&
    (requestUrl.pathname === "/recent-searches" ||
      requestUrl.pathname.startsWith("/recent-searches/"))
  ) {
    handleDeleteRecentSearches(request, response);
    return;
  }

  if (method === "POST" && (requestUrl.pathname === "/saved-searches" || requestUrl.pathname === "/me/saved-searches")) {
    await handleCreateSavedSearch(request, response);
    return;
  }

  if (
    method === "GET" &&
    (
      requestUrl.pathname === "/saved-searches" ||
      requestUrl.pathname.startsWith("/saved-searches/") ||
      requestUrl.pathname === "/me/saved-searches" ||
      requestUrl.pathname.startsWith("/me/saved-searches/")
    )
  ) {
    handleGetSavedSearches(request, response);
    return;
  }

  if (method === "DELETE" && (requestUrl.pathname === "/saved-searches" || requestUrl.pathname === "/me/saved-searches")) {
    await handleDeleteSavedSearch(request, response);
    return;
  }

  if (method === "POST" && requestUrl.pathname === "/me/saved-filters") {
    await handleCreateSavedFilter(request, response);
    return;
  }

  if (
    method === "GET" &&
    (requestUrl.pathname === "/me/saved-filters" || requestUrl.pathname.startsWith("/me/saved-filters/"))
  ) {
    handleGetSavedFilters(request, response);
    return;
  }

  if (method === "DELETE" && requestUrl.pathname === "/me/saved-filters") {
    await handleDeleteSavedFilter(request, response);
    return;
  }

  if (method === "POST" && requestUrl.pathname === "/me/watchlists") {
    await handleCreateWatchlist(request, response);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/me/watchlists") {
    handleGetWatchlists(request, response);
    return;
  }

  const watchlistId = getPathId(requestUrl.pathname, "/me/watchlists");

  if (method === "PATCH" && watchlistId) {
    await handlePatchWatchlist(request, response, watchlistId);
    return;
  }

  if (method === "DELETE" && (requestUrl.pathname === "/me/watchlists" || watchlistId)) {
    await handleDeleteWatchlist(request, response, watchlistId);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/me/notification-preferences") {
    handleGetNotificationPreferences(request, response);
    return;
  }

  if (method === "PATCH" && requestUrl.pathname === "/me/notification-preferences") {
    await handlePatchNotificationPreferences(request, response);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/me/alert-matches") {
    handleGetAlertMatches(request, response);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/me/settings") {
    handleGetSettings(request, response);
    return;
  }

  if (method === "PATCH" && requestUrl.pathname === "/me/settings") {
    await handlePatchSettings(request, response);
    return;
  }

  sendJson(request, response, 404, {
    error: "not_found",
    message: "Route not found.",
  });
}

export function createApp() {
  return createServer((request, response) => {
    const startedAt = performance.now();
    const requestWithContext = request as IncomingMessage & { __requestId?: string };
    requestWithContext.__requestId = createRequestId();
    const recordCompletion = () => {
      incrementCounter("closetsearch_http_requests_total", {
        method: request.method ?? "GET",
        status: String(response.statusCode || 0),
      });
    };

    if (typeof response.once === "function") {
      response.once("finish", recordCompletion);
    }

    void handleRequest(request, response).catch((error: unknown) => {
      const requestContext = {
        method: request.method ?? "GET",
        path: request.url ?? "/",
        requestId: getRequestId(request),
      };

      if (isApiError(error)) {
        logWarn("Handled API error", {
          ...requestContext,
          errorCode: error.code,
          statusCode: error.statusCode,
        });
        sendJson(
          request,
          response,
          error.statusCode,
          {
            error: error.code,
            message: error.message,
          },
          {
            ...getErrorHeaders(error),
            ...("retryAfterSeconds" in error &&
            typeof error.retryAfterSeconds === "number"
              ? {
                  "retry-after": String(error.retryAfterSeconds),
                }
              : {}),
          },
        );
        return;
      }

      logError("Unhandled API error", {
        ...requestContext,
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Unknown error",
      });

      sendJson(request, response, 500, {
        error: "internal_error",
        message: "The API could not complete the request.",
      });
    }).finally(() => {
      if (typeof response.once !== "function") {
        recordCompletion();
      }

      const durationMs = performance.now() - startedAt;
      if (durationMs >= 1_000) {
        logWarn("Slow API request", {
          durationMs: Math.round(durationMs),
          method: request.method ?? "GET",
          path: request.url ?? "/",
          requestId: getRequestId(request),
        });
      }
    });
  });
}
