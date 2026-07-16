import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type {
  FeedQuery,
  Listing,
  ListingMarketStatus,
  ListingType,
  OnboardingPreferences,
  SearchQuery,
  SearchSortMode,
} from "@closetsearch/shared";
import { isApiError } from "./api-error.js";
import { getAuthConfig } from "./auth/config.js";
import { requireAuth, getOptionalAuthContext } from "./auth/auth-context.js";
import {
  clearSessionCookie,
  createAuthSession,
  getAuthSessionFromRequest,
  revokeAllSessionsForUser,
  revokeCurrentSession,
} from "./auth/session-service.js";
import { getFeed } from "./feed-service.js";
import { addLike, getLikedListingsByUserId, getLikesByUserId, removeLike } from "./like-service.js";
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
import { createProviderRuntime } from "./providers/registry.js";
import { getSettingsByUserId, updateSettings } from "./user-settings-service.js";
import {
  analyticsUsesSampleData,
  getAnalyticsOverview,
  getMarketInsights,
  getUnderpricedListingSignals,
} from "./services/analyticsService.js";
import { findBrandBySlug, listBrands } from "./services/brandService.js";
import {
  getPremiumAccess,
  getPremiumPreviewUsername,
} from "./services/premiumAccessService.js";
import { createUser, loginUser, saveOnboardingPreferences } from "./user-service.js";
import { addWatchlist, getWatchlistsByUserId, removeWatchlist } from "./watchlist-service.js";

function buildCorsHeaders(request: IncomingMessage) {
  const origin =
    typeof request.headers?.origin === "string" ? request.headers.origin.trim() : "";
  const authConfig = getAuthConfig();
  const headers: Record<string, string> = {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  };

  if (origin && authConfig.allowedOrigins.has(origin)) {
    headers["access-control-allow-credentials"] = "true";
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }

  return headers;
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
) {
  response.writeHead(statusCode, {
    ...buildCorsHeaders(request),
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
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
    ...buildCorsHeaders(request),
    ...extraHeaders,
  });
  response.end();
}

async function parseJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  const body = Buffer.concat(chunks).toString("utf-8").trim();

  if (body.length === 0) {
    return null;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("invalid_json");
  }
}

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

function toOptionalSavedFilterListingType(value: unknown) {
  if (value === "auction" || value === "buy_now") {
    return value;
  }

  if (value === "fixed_price") {
    return "buy_now";
  }

  return undefined;
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
  const authSession = getAuthSessionFromRequest(request);

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

async function handleCreateWatchlist(
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

  const watchlist = addWatchlist({
    userId: user.id,
    label,
    queryText: toTrimmedString(body?.queryText) || undefined,
    brand: toTrimmedString(body?.brand) || undefined,
    maxPrice: toOptionalNumber(body?.maxPrice),
    source: toTrimmedString(body?.source) || undefined,
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

async function handleDeleteWatchlist(
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
    removed: removeWatchlist({
      userId: user.id,
      id,
    }),
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

function handleListBrands(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  query: string | null,
) {
  const brands = listBrands(query ?? undefined);

  sendJson(request, response, 200, {
    brands,
    query: query?.trim() || undefined,
    total: brands.length,
  });
}

function handleGetBrand(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  slug: string,
) {
  const brand = findBrandBySlug(slug);

  if (!brand) {
    sendJson(request, response, 404, {
      error: "not_found",
      message: "Brand not found.",
    });
    return;
  }

  sendJson(request, response, 200, {
    brand,
  });
}

function getAnalyticsUser(request: IncomingMessage) {
  return getOptionalAuthContext(request)?.user;
}

function sendLockedAnalyticsResponse(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  userId?: string,
) {
  sendJson(request, response, 200, {
    locked: true,
    message:
      "Observed pricing context is part of Collector Preview. Brand ranges, category ranges, and cautious under-market signals use only listings ClosetSearch has observed.",
    premiumAccess: userId
      ? {
          userId,
          isPremium: false,
          planName: "Free",
        }
      : undefined,
    premiumPreviewUsername: getPremiumPreviewUsername(),
  });
}

function handleAnalyticsOverview(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = getAnalyticsUser(request);
  const premiumAccess = getPremiumAccess(user);

  if (!premiumAccess?.isPremium) {
    sendLockedAnalyticsResponse(request, response, user?.id);
    return;
  }

  sendJson(request, response, 200, {
    locked: false,
    premiumAccess,
    overview: getAnalyticsOverview(),
    sampleData: analyticsUsesSampleData(),
  });
}

function handleMarketInsights(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = getAnalyticsUser(request);
  const premiumAccess = getPremiumAccess(user);

  if (!premiumAccess?.isPremium) {
    sendLockedAnalyticsResponse(request, response, user?.id);
    return;
  }

  const insights = getMarketInsights();

  sendJson(request, response, 200, {
    locked: false,
    premiumAccess,
    brandSummaries: insights.brandSummaries,
    categorySummaries: insights.categorySummaries,
    sampleData: analyticsUsesSampleData(),
  });
}

function handleUnderpricedSignals(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const user = getAnalyticsUser(request);
  const premiumAccess = getPremiumAccess(user);

  if (!premiumAccess?.isPremium) {
    sendLockedAnalyticsResponse(request, response, user?.id);
    return;
  }

  sendJson(request, response, 200, {
    locked: false,
    premiumAccess,
    signals: getUnderpricedListingSignals(),
    sampleData: analyticsUsesSampleData(),
  });
}

function handleProviderHealth(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const runtime = createProviderRuntime();

  sendJson(request, response, 200, {
    providerRuntimeMode: runtime.config.mode,
    allowMockFallback: runtime.config.allowMockFallback,
    requestTimeoutMs: runtime.config.requestTimeoutMs,
    maxProvidersPerRequest: runtime.config.maxProvidersPerRequest,
    providers: runtime.statuses.map((status) => ({
      id: status.id,
      displayName: status.name,
      providerMode: status.providerMode,
      mode: status.mode,
      enabled: status.enabled,
      configured: status.configured,
      active: status.active,
      scrapingAllowed: status.scrapingAllowed,
      implementationStatus: status.implementationStatus,
      requiredEnvVars: status.requiredEnvVars,
      capabilities: status.capabilities,
      reasons: status.reasons,
      lastErrorCategory: status.lastErrorCategory,
    })),
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

  if (method === "GET" && requestUrl.pathname === "/health") {
    sendJson(request, response, 200, {
      service: "closetsearch-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/providers/health") {
    handleProviderHealth(request, response);
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

  if (method === "GET" && requestUrl.pathname === "/analytics/overview") {
    handleAnalyticsOverview(request, response);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/analytics/market-insights") {
    handleMarketInsights(request, response);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/analytics/underpriced") {
    handleUnderpricedSignals(request, response);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/brands") {
    handleListBrands(request, response, requestUrl.searchParams.get("q"));
    return;
  }

  if (method === "GET" && requestUrl.pathname.startsWith("/brands/")) {
    handleGetBrand(
      request,
      response,
      decodeURIComponent(requestUrl.pathname.replace("/brands/", "")),
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

  if (
    method === "GET" &&
    (requestUrl.pathname === "/me/watchlists" || requestUrl.pathname.startsWith("/me/watchlists/"))
  ) {
    handleGetWatchlists(request, response);
    return;
  }

  if (method === "DELETE" && requestUrl.pathname === "/me/watchlists") {
    await handleDeleteWatchlist(request, response);
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
    void handleRequest(request, response).catch((error: unknown) => {
      if (error instanceof Error && error.message === "invalid_json") {
        sendValidationError(request, response, "The request body must be valid JSON.", 400, "invalid_json");
        return;
      }

      if (isApiError(error)) {
        sendJson(
          request,
          response,
          error.statusCode,
          {
            error: error.code,
            message: error.message,
          },
          getErrorHeaders(error),
        );
        return;
      }

      console.error("Unhandled API error", error);

      sendJson(request, response, 500, {
        error: "internal_error",
        message: "The API could not complete the request.",
      });
    });
  });
}
