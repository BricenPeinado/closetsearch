import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type {
  FeedQuery,
  ListingType,
  OnboardingPreferences,
  SearchQuery,
  SearchSortMode,
} from "@closetsearch/shared";
import { isApiError } from "./api-error.js";
import { getFeed } from "./feed-service.js";
import { addLike, getLikesByUserId, removeLike } from "./like-service.js";
import { searchListings } from "./search-service.js";
import { createProviderRuntime } from "./providers/registry.js";
import {
  getAnalyticsOverview,
  getMarketInsights,
  getUnderpricedListingSignals,
} from "./services/analyticsService.js";
import { findBrandBySlug, listBrands } from "./services/brandService.js";
import {
  getPremiumAccess,
  getPremiumPreviewUsername,
} from "./services/premiumAccessService.js";
import {
  createUser,
  getUserById,
  loginUser,
  saveOnboardingPreferences,
} from "./user-service.js";

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-origin": "*",
};

function sendJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: unknown,
) {
  response.writeHead(statusCode, {
    ...corsHeaders,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response: ServerResponse<IncomingMessage>, statusCode: number) {
  response.writeHead(statusCode, corsHeaders);
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

  return JSON.parse(body) as unknown;
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

function parseSearchQuery(requestUrl: URL): SearchQuery | null {
  const text = requestUrl.searchParams.get("q")?.trim() ?? "";

  if (text.length === 0) {
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

function parseFeedQuery(requestUrl: URL): FeedQuery {
  const page = parsePositiveInteger(requestUrl.searchParams.get("page"), 1);
  const requestedPageSize = parsePositiveInteger(
    requestUrl.searchParams.get("pageSize"),
    12,
  );

  return {
    cursor: requestUrl.searchParams.get("cursor") ?? undefined,
    page,
    pageSize: Math.min(requestedPageSize, 24),
    userId: requestUrl.searchParams.get("userId")?.trim() || undefined,
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
  response: ServerResponse<IncomingMessage>,
  message: string,
  statusCode = 400,
) {
  sendJson(response, statusCode, {
    error: "invalid_request",
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
    sendValidationError(response, "Username and password are required.");
    return;
  }

  try {
    sendJson(response, 201, createUser(username, password));
  } catch (error: unknown) {
    sendValidationError(
      response,
      error instanceof Error ? error.message : "The user could not be created.",
    );
  }
}

async function handleLogin(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const username = toTrimmedString(body?.username);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || !password) {
    sendValidationError(response, "Username and password are required.");
    return;
  }

  try {
    sendJson(response, 200, loginUser(username, password));
  } catch (error: unknown) {
    sendValidationError(
      response,
      error instanceof Error ? error.message : "The credentials were invalid.",
      401,
    );
  }
}

async function handleOnboarding(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const userId = toTrimmedString(body?.userId);

  if (!userId) {
    sendValidationError(response, "A userId is required.");
    return;
  }

  try {
    sendJson(
      response,
      200,
      saveOnboardingPreferences(
        userId,
        toOnboardingPreferences(body?.preferences),
        toTrimmedString(body?.currencyPreference) || undefined,
      ),
    );
  } catch (error: unknown) {
    sendValidationError(
      response,
      error instanceof Error ? error.message : "The onboarding preferences could not be saved.",
      404,
    );
  }
}

async function handleCreateLike(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const userId = toTrimmedString(body?.userId);
  const listingId = toTrimmedString(body?.listingId);
  const source = toTrimmedString(body?.source);

  if (!userId || !listingId || !source) {
    sendValidationError(response, "userId, listingId, and source are required.");
    return;
  }

  if (!getUserById(userId)) {
    sendValidationError(response, "User not found.", 404);
    return;
  }

  const like = addLike(userId, listingId, source);

  sendJson(response, 201, {
    like,
  });
}

async function handleDeleteLike(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const body = (await parseJsonBody(request)) as Record<string, unknown> | null;
  const userId = toTrimmedString(body?.userId);
  const listingId = toTrimmedString(body?.listingId);

  if (!userId || !listingId) {
    sendValidationError(response, "userId and listingId are required.");
    return;
  }

  sendJson(response, 200, {
    removed: removeLike(userId, listingId),
  });
}

function handleGetLikes(
  response: ServerResponse<IncomingMessage>,
  userId: string,
) {
  if (!userId) {
    sendValidationError(response, "A userId is required.");
    return;
  }

  sendJson(response, 200, {
    userId,
    likes: getLikesByUserId(userId),
  });
}

function handleListBrands(
  response: ServerResponse<IncomingMessage>,
  query: string | null,
) {
  const brands = listBrands(query ?? undefined);

  sendJson(response, 200, {
    brands,
    query: query?.trim() || undefined,
    total: brands.length,
  });
}

function handleGetBrand(
  response: ServerResponse<IncomingMessage>,
  slug: string,
) {
  const brand = findBrandBySlug(slug);

  if (!brand) {
    sendJson(response, 404, {
      error: "not_found",
      message: "Brand not found.",
    });
    return;
  }

  sendJson(response, 200, {
    brand,
  });
}

function getAnalyticsUser(requestUrl: URL) {
  const userId = requestUrl.searchParams.get("userId")?.trim();

  if (!userId) {
    return undefined;
  }

  return getUserById(userId);
}

function sendLockedAnalyticsResponse(
  response: ServerResponse<IncomingMessage>,
  userId?: string,
) {
  sendJson(response, 200, {
    locked: true,
    message:
      "Premium analytics is still a placeholder. Market insights, underpriced signals, and pricing context are preview-only for now.",
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
  response: ServerResponse<IncomingMessage>,
  requestUrl: URL,
) {
  const user = getAnalyticsUser(requestUrl);
  const premiumAccess = getPremiumAccess(user);

  if (!premiumAccess?.isPremium) {
    sendLockedAnalyticsResponse(response, user?.id);
    return;
  }

  sendJson(response, 200, {
    locked: false,
    premiumAccess,
    overview: getAnalyticsOverview(),
    sampleData: true,
  });
}

function handleMarketInsights(
  response: ServerResponse<IncomingMessage>,
  requestUrl: URL,
) {
  const user = getAnalyticsUser(requestUrl);
  const premiumAccess = getPremiumAccess(user);

  if (!premiumAccess?.isPremium) {
    sendLockedAnalyticsResponse(response, user?.id);
    return;
  }

  sendJson(response, 200, {
    locked: false,
    premiumAccess,
    insights: getMarketInsights(),
    sampleData: true,
  });
}

function handleUnderpricedSignals(
  response: ServerResponse<IncomingMessage>,
  requestUrl: URL,
) {
  const user = getAnalyticsUser(requestUrl);
  const premiumAccess = getPremiumAccess(user);

  if (!premiumAccess?.isPremium) {
    sendLockedAnalyticsResponse(response, user?.id);
    return;
  }

  sendJson(response, 200, {
    locked: false,
    premiumAccess,
    signals: getUnderpricedListingSignals(),
    sampleData: true,
  });
}

function handleProviderHealth(response: ServerResponse<IncomingMessage>) {
  const runtime = createProviderRuntime();

  sendJson(response, 200, {
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

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (method === "OPTIONS") {
    sendEmpty(response, 204);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      service: "closetsearch-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/providers/health") {
    handleProviderHealth(response);
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

  if (method === "POST" && requestUrl.pathname === "/users/onboarding") {
    await handleOnboarding(request, response);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/search") {
    const query = parseSearchQuery(requestUrl);

    if (!query) {
      sendJson(response, 400, {
        error: "invalid_query",
        message: 'The "q" query parameter is required.',
      });
      return;
    }

    const result = await searchListings(query);

    sendJson(response, 200, result);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/feed") {
    const result = await getFeed(parseFeedQuery(requestUrl));

    sendJson(response, 200, result);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/analytics/overview") {
    handleAnalyticsOverview(response, requestUrl);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/analytics/market-insights") {
    handleMarketInsights(response, requestUrl);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/analytics/underpriced") {
    handleUnderpricedSignals(response, requestUrl);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/brands") {
    handleListBrands(response, requestUrl.searchParams.get("q"));
    return;
  }

  if (method === "GET" && requestUrl.pathname.startsWith("/brands/")) {
    handleGetBrand(
      response,
      decodeURIComponent(requestUrl.pathname.replace("/brands/", "")),
    );
    return;
  }

  if (method === "POST" && requestUrl.pathname === "/likes") {
    await handleCreateLike(request, response);
    return;
  }

  if (method === "DELETE" && requestUrl.pathname === "/likes") {
    await handleDeleteLike(request, response);
    return;
  }

  if (method === "GET" && requestUrl.pathname.startsWith("/likes/")) {
    handleGetLikes(response, decodeURIComponent(requestUrl.pathname.replace("/likes/", "")));
    return;
  }

  sendJson(response, 404, {
    error: "not_found",
    message: "Route not found.",
  });
}

export function createApp() {
  return createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      if (isApiError(error)) {
        sendJson(response, error.statusCode, {
          error: error.code,
          message: error.message,
        });
        return;
      }

      console.error("Unhandled API error", error);

      sendJson(response, 500, {
        error: "internal_error",
        message: "The API could not complete the request.",
      });
    });
  });
}
