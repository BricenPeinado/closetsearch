import type { IncomingMessage } from "node:http";
import type {
  Listing,
  ListingCondition,
  SavedFilterListingType,
  SearchSortMode,
  WatchlistInput,
} from "@closetsearch/shared";
import { ApiError } from "../api-error.js";
import { requireAuth } from "../auth/auth-context.js";
import { parseJsonRequestBody } from "../http/request-body.js";
import { AlertInboxService } from "../services/alertInboxService.js";
import { listPostgresLikedListings } from "../services/postgresLikedListingService.js";
import { toListingObservation } from "../worker/provider-source.js";
import type { RouteResult } from "./route-result.js";
import {
  getRequestDataPlane,
  isPostgresRequestPath,
  optionalBoolean,
  optionalNumber,
  pathId,
  stringArray,
  toPostgresApiError,
  trimmedString,
} from "./postgres-route-support.js";

async function payload(request: IncomingMessage) {
  const raw = await parseJsonRequestBody(request);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "invalid_request", "A JSON object is required.");
  }

  const value = raw as Record<string, unknown>;

  if ("userId" in value || "user_id" in value) {
    throw new ApiError(
      400,
      "spoofed_user_id",
      "User identity is derived from the authenticated session.",
    );
  }

  return value;
}

function optionalListing(value: unknown): Listing | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const listing = value as Listing;

  return typeof listing.id === "string" &&
    typeof listing.providerId === "string" &&
    typeof listing.providerListingId === "string" &&
    typeof listing.sourceUrl === "string" &&
    typeof listing.title === "string" &&
    typeof listing.fetchedAt === "string" &&
    typeof listing.imageUrl === "string" &&
    typeof listing.price?.amount === "number" &&
    typeof listing.price?.currency === "string" &&
    typeof listing.source?.id === "string" &&
    typeof listing.source?.name === "string" &&
    typeof listing.brand?.id === "string" &&
    typeof listing.brand?.slug === "string" &&
    typeof listing.brand?.name === "string"
    ? listing
    : undefined;
}

function listingType(value: unknown): SavedFilterListingType | undefined {
  return value === "auction" || value === "buy_now" ? value : undefined;
}

function sortMode(value: unknown): SearchSortMode | undefined {
  return value === "newest" ||
    value === "price_asc" ||
    value === "price_desc" ||
    value === "relevance"
    ? value
    : undefined;
}

function condition(value: unknown): ListingCondition | undefined {
  return value === "new_with_tags" ||
    value === "new_without_tags" ||
    value === "excellent" ||
    value === "good" ||
    value === "fair" ||
    value === "unknown"
    ? value
    : undefined;
}

function watchlistInput(body: Record<string, unknown>): WatchlistInput {
  return {
    brand: trimmedString(body.brand) || undefined,
    category: trimmedString(body.category) || undefined,
    condition: condition(body.condition),
    enabled: optionalBoolean(body.enabled),
    label: trimmedString(body.label) || undefined,
    listingType: listingType(body.listingType),
    maxPriceAmount: optionalNumber(body.maxPriceAmount ?? body.maxPrice),
    minPriceAmount: optionalNumber(body.minPriceAmount ?? body.minPrice),
    priceCurrency: trimmedString(body.priceCurrency) || undefined,
    queryText: trimmedString(body.queryText) || undefined,
    size: trimmedString(body.size) || undefined,
    source: trimmedString(body.source) || undefined,
  };
}

function watchlistLabel(input: WatchlistInput) {
  if (input.label) {
    return input.label;
  }

  const subject =
    input.brand ??
    input.category ??
    input.queryText ??
    input.source ??
    (input.size ? `Size ${input.size}` : undefined) ??
    "Watchlist";

  return input.maxPriceAmount !== undefined
    ? `${subject} under ${input.priceCurrency ?? "USD"} ${input.maxPriceAmount}`
    : subject;
}

function notificationFrequency(value: unknown) {
  return value === "instant" || value === "daily" || value === "weekly"
    ? value
    : undefined;
}

function response(body: unknown, statusCode = 200): RouteResult {
  return {
    body,
    kind: "json",
    statusCode,
  };
}

export async function handlePostgresSavedRoute(
  request: IncomingMessage,
  requestUrl: URL,
): Promise<RouteResult | undefined> {
  if (!isPostgresRequestPath()) {
    return undefined;
  }

  const method = request.method ?? "GET";
  const path = requestUrl.pathname;
  const isLikesPath =
    path === "/likes" ||
    path.startsWith("/likes/") ||
    path === "/me/likes" ||
    path.startsWith("/me/likes/");
  const isSavedSearchPath =
    path === "/saved-searches" ||
    path.startsWith("/saved-searches/") ||
    path === "/me/saved-searches" ||
    path.startsWith("/me/saved-searches/");
  const watchlistId = pathId(path, "/me/watchlists");

  try {
    if (isLikesPath) {
      const user = requireAuth(request);
      const dataPlane = await getRequestDataPlane();

      if (method === "GET") {
        const [likes, likedListings] = await Promise.all([
          dataPlane.requestStore.listLikesByUserId(user.id),
          listPostgresLikedListings(dataPlane, user.id),
        ]);
        return response({ likedListings, likes, userId: user.id });
      }

      const body = await payload(request);

      if (method === "POST") {
        const listingId = trimmedString(body.listingId);
        const source = trimmedString(body.source);
        const listing = optionalListing(body.listing);

        if (!listingId || !source || !listing) {
          throw new ApiError(
            400,
            "invalid_request",
            "listingId, source, and a normalized listing snapshot are required.",
          );
        }

        if (listing.id !== listingId) {
          throw new ApiError(
            400,
            "listing_identity_mismatch",
            "The listing snapshot does not match listingId.",
          );
        }

        await dataPlane.listings.upsertObservation(
          toListingObservation(
            listing,
            listing.market?.status === "sold" ? "sold" : "active",
          ),
        );
        const like = await dataPlane.requestStore.upsertLike({
          listingId,
          source,
          userId: user.id,
        });

        return response(
          {
            likedListing: {
              like,
              listing,
              snapshotStatus: "snapshot",
            },
            userId: user.id,
          },
          201,
        );
      }

      if (method === "DELETE") {
        const id = trimmedString(body.id);
        const listingId = trimmedString(body.listingId);

        if (!id && !listingId) {
          throw new ApiError(
            400,
            "invalid_request",
            "Either id or listingId is required.",
          );
        }

        return response({
          removed: await dataPlane.requestStore.deleteLike({
            id: id || undefined,
            listingId: listingId || undefined,
            userId: user.id,
          }),
          userId: user.id,
        });
      }
    }

    if (
      path === "/recent-searches" ||
      path.startsWith("/recent-searches/")
    ) {
      const user = requireAuth(request);
      const dataPlane = await getRequestDataPlane();

      if (method === "GET") {
        return response({
          recentSearches:
            await dataPlane.requestStore.listRecentSearchesByUserId(user.id),
          userId: user.id,
        });
      }

      if (method === "DELETE") {
        await dataPlane.requestStore.clearRecentSearches(user.id);
        return response({ cleared: true, userId: user.id });
      }

      if (method === "POST") {
        const body = await payload(request);
        const label = trimmedString(body.label);
        const description = trimmedString(body.description);
        const params = trimmedString(body.params);

        if (!label || !description || !params) {
          throw new ApiError(
            400,
            "invalid_request",
            "label, description, and params are required.",
          );
        }

        const recentSearch = await dataPlane.requestStore.upsertRecentSearch({
          description,
          label,
          params,
          userId: user.id,
        });
        return response(
          {
            recentSearch,
            recentSearches:
              await dataPlane.requestStore.listRecentSearchesByUserId(user.id),
            userId: user.id,
          },
          201,
        );
      }
    }

    if (isSavedSearchPath) {
      const user = requireAuth(request);
      const dataPlane = await getRequestDataPlane();

      if (method === "GET") {
        return response({
          savedSearches:
            await dataPlane.requestStore.listSavedSearchesByUserId(user.id),
          userId: user.id,
        });
      }

      const body = await payload(request);

      if (method === "POST") {
        const label = trimmedString(body.label);
        const description = trimmedString(body.description);
        const params = trimmedString(body.params);

        if (!label || !description || !params) {
          throw new ApiError(
            400,
            "invalid_request",
            "label, description, and params are required.",
          );
        }

        const savedSearch = await dataPlane.requestStore.upsertSavedSearch({
          description,
          label,
          params,
          userId: user.id,
        });
        return response(
          {
            savedSearch,
            savedSearches:
              await dataPlane.requestStore.listSavedSearchesByUserId(user.id),
            userId: user.id,
          },
          201,
        );
      }

      if (method === "DELETE") {
        const id = trimmedString(body.id);
        const params = trimmedString(body.params);

        if (!id && !params) {
          throw new ApiError(
            400,
            "invalid_request",
            "Either id or params is required.",
          );
        }

        return response({
          removed: await dataPlane.requestStore.deleteSavedSearch({
            id: id || undefined,
            params: params || undefined,
            userId: user.id,
          }),
          userId: user.id,
        });
      }
    }

    if (
      path === "/me/saved-filters" ||
      path.startsWith("/me/saved-filters/")
    ) {
      const user = requireAuth(request);
      const dataPlane = await getRequestDataPlane();

      if (method === "GET") {
        return response({
          savedFilters:
            await dataPlane.requestStore.listSavedFiltersByUserId(user.id),
          userId: user.id,
        });
      }

      const body = await payload(request);

      if (method === "POST") {
        const label = trimmedString(body.label);

        if (!label) {
          throw new ApiError(
            400,
            "invalid_request",
            "label is required.",
          );
        }

        const savedFilter = await dataPlane.requestStore.upsertSavedFilter({
          label,
          listingType: listingType(body.listingType),
          maxPrice: optionalNumber(body.maxPrice),
          minPrice: optionalNumber(body.minPrice),
          queryText: trimmedString(body.queryText) || undefined,
          sortMode: sortMode(body.sortMode),
          source: trimmedString(body.source) || undefined,
          userId: user.id,
        });
        return response(
          {
            savedFilter,
            savedFilters:
              await dataPlane.requestStore.listSavedFiltersByUserId(user.id),
            userId: user.id,
          },
          201,
        );
      }

      if (method === "DELETE") {
        const id = trimmedString(body.id);

        if (!id) {
          throw new ApiError(400, "invalid_request", "id is required.");
        }

        return response({
          removed: await dataPlane.requestStore.deleteSavedFilter(user.id, id),
          userId: user.id,
        });
      }
    }

    if (path === "/me/watchlists" || watchlistId) {
      const user = requireAuth(request);
      const dataPlane = await getRequestDataPlane();

      if (method === "GET" && !watchlistId) {
        return response({
          userId: user.id,
          watchlists:
            await dataPlane.requestStore.listWatchlistsByUserId(user.id),
        });
      }

      const body = await payload(request);

      if (method === "POST" && !watchlistId) {
        const input = watchlistInput(body);
        const watchlist = await dataPlane.requestStore.createWatchlist({
          ...input,
          label: watchlistLabel(input),
          userId: user.id,
        });
        return response(
          {
            userId: user.id,
            watchlist,
            watchlists:
              await dataPlane.requestStore.listWatchlistsByUserId(user.id),
          },
          201,
        );
      }

      if (method === "PATCH" && watchlistId) {
        const input = watchlistInput(body);
        const watchlist = await dataPlane.requestStore.updateWatchlist({
          ...input,
          id: watchlistId,
          label: input.label,
          userId: user.id,
        });

        if (!watchlist) {
          throw new ApiError(
            404,
            "watchlist_not_found",
            "Watchlist was not found.",
          );
        }

        return response({
          userId: user.id,
          watchlist,
          watchlists:
            await dataPlane.requestStore.listWatchlistsByUserId(user.id),
        });
      }

      if (method === "DELETE") {
        const id = watchlistId ?? trimmedString(body.id);

        if (!id) {
          throw new ApiError(400, "invalid_request", "id is required.");
        }

        return response({
          removed: await dataPlane.requestStore.deleteWatchlist(user.id, id),
          userId: user.id,
        });
      }
    }

    if (path === "/me/notification-preferences") {
      const user = requireAuth(request);
      const dataPlane = await getRequestDataPlane();

      if (method === "GET") {
        return response({
          notificationPreferences:
            await dataPlane.requestStore.getNotificationPreferencesByUserId(
              user.id,
            ),
          userId: user.id,
        });
      }

      if (method === "PATCH") {
        const body = await payload(request);

        if (
          body.emailEnabled === true ||
          body.pushEnabled === true ||
          body.smsEnabled === true
        ) {
          throw new ApiError(
            409,
            "delivery_channel_unavailable",
            "Email, push, and SMS delivery are disabled until a verified delivery provider is implemented.",
          );
        }

        const notificationPreferences =
          await dataPlane.requestStore.updateNotificationPreferences({
            emailEnabled: optionalBoolean(body.emailEnabled),
            frequency: notificationFrequency(body.frequency),
            inAppEnabled: optionalBoolean(body.inAppEnabled),
            pushEnabled: optionalBoolean(body.pushEnabled),
            quietHoursEnd:
              body.quietHoursEnd === null
                ? null
                : trimmedString(body.quietHoursEnd) || undefined,
            quietHoursStart:
              body.quietHoursStart === null
                ? null
                : trimmedString(body.quietHoursStart) || undefined,
            smsEnabled: optionalBoolean(body.smsEnabled),
            userId: user.id,
          });
        return response({ notificationPreferences, userId: user.id });
      }
    }

    if (path === "/me/settings") {
      const user = requireAuth(request);
      const dataPlane = await getRequestDataPlane();

      if (method === "GET") {
        return response({
          settings: await dataPlane.requestStore.getUserSettings(user.id),
          userId: user.id,
        });
      }

      if (method === "PATCH") {
        const body = await payload(request);
        const settings = await dataPlane.requestStore.updateUserSettings({
          defaultSortMode: Object.prototype.hasOwnProperty.call(
            body,
            "defaultSortMode",
          )
            ? body.defaultSortMode === null
              ? null
              : sortMode(body.defaultSortMode)
            : undefined,
          displayName: Object.prototype.hasOwnProperty.call(body, "displayName")
            ? body.displayName === null
              ? null
              : trimmedString(body.displayName) || null
            : undefined,
          preferredCurrency:
            trimmedString(body.preferredCurrency) || undefined,
          preferredSources: Object.prototype.hasOwnProperty.call(
            body,
            "preferredSources",
          )
            ? stringArray(body.preferredSources)
            : undefined,
          userId: user.id,
        });
        return response({ settings, userId: user.id });
      }
    }

    if (path === "/me/alert-matches" || path === "/me/alerts") {
      const user = requireAuth(request);
      const dataPlane = await getRequestDataPlane();
      const inbox = new AlertInboxService(dataPlane);

      if (method === "GET") {
        const result = await inbox.list(user.id);
        return response(
          path === "/me/alert-matches"
            ? {
                alertMatches: result.alerts,
                deliveryActive: true,
                message:
                  "In-app alerts are active. Email remains disabled until a provider and verified address are configured.",
                unseenCount: result.unseenCount,
                userId: user.id,
              }
            : { ...result, userId: user.id },
        );
      }
    }

    if (
      method === "POST" &&
      (path === "/me/alerts/seen" || path === "/me/alerts/dismiss")
    ) {
      const user = requireAuth(request);
      const dataPlane = await getRequestDataPlane();
      const body = await payload(request);
      const inbox = new AlertInboxService(dataPlane);
      const result =
        path === "/me/alerts/seen"
          ? await inbox.markSeen(user.id, body)
          : await inbox.dismiss(user.id, body);
      return response(result);
    }
  } catch (error) {
    toPostgresApiError(error);
  }

  return undefined;
}
