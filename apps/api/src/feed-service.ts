import type { FeedQuery, FeedResponse, Listing, SearchQuery } from "@closetsearch/shared";
import { ApiError } from "./api-error.js";
import { getLikedListingsByUserId } from "./like-service.js";
import { createProviderRuntime, type ProviderRuntime } from "./providers/registry.js";
import { runProviderSearch } from "./providers/orchestrator.js";
import { getSavedFiltersByUserId } from "./saved-filter-service.js";
import { getSavedSearchesByUserId } from "./saved-search-service.js";
import { getUserById } from "./user-service.js";
import { getSettingsByUserId } from "./user-settings-service.js";
import { getWatchlistsByUserId } from "./watchlist-service.js";
import { logWarn } from "./logger.js";
import { rememberListings } from "./services/listingCatalogService.js";
import { buildPersonalizationProfile } from "./services/personalizationSignalsService.js";
import { recordObservedListings } from "./services/priceSnapshotService.js";
import { rankListings } from "./services/recommendationService.js";
import { generateRiskSignal } from "./services/riskService.js";
import { applyDisplayCurrency } from "./services/exchangeRateService.js";

const defaultFeedSort: SearchQuery["sort"] = "newest";
const defaultFeedPageSize = 12;

function sortListings(listings: Listing[]) {
  return [...listings].sort(
    (left, right) =>
      new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime(),
  );
}

function attachRiskSignal(listing: Listing): Listing {
  return {
    ...listing,
    riskSignal: generateRiskSignal(listing),
  };
}

function rememberAnalyticsListings(listings: Listing[]) {
  try {
    recordObservedListings(listings);
  } catch (error) {
    logWarn("Analytics snapshot recording failed", {
      message: error instanceof Error ? error.message : "Unknown analytics snapshot error",
      route: "feed",
    });
  }
}

function shouldThrowProviderUnavailable(
  providers: Array<{ status: "success" | "failure" }>,
  listings: Listing[],
) {
  return (
    listings.length === 0 &&
    providers.length > 0 &&
    providers.every((provider) => provider.status === "failure")
  );
}

export async function getFeed(
  query: FeedQuery,
  runtime: ProviderRuntime = createProviderRuntime(),
): Promise<FeedResponse> {
  const execution = await runProviderSearch(
    {
      text: "",
      marketScope: "active",
      sort: defaultFeedSort,
      cursor: query.cursor,
      page: query.page,
      pageSize: query.pageSize ?? defaultFeedPageSize,
    },
    runtime,
  );

  if (shouldThrowProviderUnavailable(execution.providers, execution.listings)) {
    throw new ApiError(502, "feed_unavailable", "The feed could not be loaded right now.");
  }

  const providerListings = execution.listings.map(attachRiskSignal);

  rememberListings(providerListings);
  rememberAnalyticsListings(providerListings);

  const user = query.userId ? getUserById(query.userId) : undefined;
  const listings = await applyDisplayCurrency(
    providerListings,
    user?.currencyPreference,
  );

  if (user === undefined) {
    const rankedListings = sortListings(listings);

    return {
      listings: rankedListings,
      isPersonalized: false,
      pagination: execution.pagination,
      personalizationSummary: {
        isPersonalized: false,
        message: "Popular finds across resale marketplaces.",
        signalCount: 0,
        signalLabels: [],
      },
      providers: execution.providers,
      debugPersonalization: query.debugPersonalization
        ? {
            scoreBreakdowns: [],
          }
        : undefined,
    };
  }

  const personalizationProfile = buildPersonalizationProfile({
    user,
    likedListings: getLikedListingsByUserId(user.id),
    savedSearches: getSavedSearchesByUserId(user.id),
    savedFilters: getSavedFiltersByUserId(user.id),
    watchlists: getWatchlistsByUserId(user.id),
    settings: getSettingsByUserId(user.id),
  });
  const recommendation = rankListings({
    listings,
    profile: personalizationProfile,
    includeDebug: Boolean(query.debugPersonalization),
  });

  return {
    listings: recommendation.listings,
    isPersonalized: recommendation.isPersonalized,
    pagination: execution.pagination,
    personalizationSummary: recommendation.personalizationSummary,
    providers: execution.providers,
    debugPersonalization: recommendation.debugPersonalization,
  };
}
