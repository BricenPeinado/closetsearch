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
import { resolvePersistenceDriver } from "./db/persistence-driver.js";
import { getPostgresDataPlane } from "./db/persistence-runtime.js";
import { rememberListings } from "./services/listingCatalogService.js";
import { getMlRecommendationRuntime } from "./services/mlRecommendationRuntimeService.js";
import { buildPersonalizationProfile } from "./services/personalizationSignalsService.js";
import { listPostgresLikedListings } from "./services/postgresLikedListingService.js";
import { recordObservedListings } from "./services/priceSnapshotService.js";
import { generateRiskSignal } from "./services/riskService.js";
import { applyDisplayCurrency } from "./services/exchangeRateService.js";

const defaultFeedSort: SearchQuery["sort"] = "newest";
const defaultFeedPageSize = 12;

function attachRiskSignal(listing: Listing): Listing {
  return {
    ...listing,
    riskSignal: generateRiskSignal(listing),
  };
}

function rememberAnalyticsListings(listings: Listing[]) {
  if (resolvePersistenceDriver() === "postgres") {
    return;
  }

  try {
    recordObservedListings(listings);
  } catch (error) {
    logWarn("Analytics snapshot recording failed", {
      message: error instanceof Error ? error.message : "Unknown analytics snapshot error",
      route: "feed",
    });
  }
}

async function loadPersonalizationInputs(userId: string) {
  if (resolvePersistenceDriver() !== "postgres") {
    const user = getUserById(userId);

    return user
      ? {
          engagementByListingId: undefined,
          likedListings: getLikedListingsByUserId(user.id),
          savedFilters: getSavedFiltersByUserId(user.id),
          savedSearches: getSavedSearchesByUserId(user.id),
          settings: getSettingsByUserId(user.id),
          user,
          watchlists: getWatchlistsByUserId(user.id),
        }
      : undefined;
  }

  const dataPlane = await getPostgresDataPlane();
  const user = await dataPlane.requestStore.findUserById(userId);

  if (!user) {
    return undefined;
  }

  const engagementSince = new Date();
  engagementSince.setUTCDate(engagementSince.getUTCDate() - 90);
  const [
    engagementByListingId,
    likedListings,
    savedFilters,
    savedSearches,
    settings,
    watchlists,
  ] = await Promise.all([
    dataPlane.engagement.getUserListingScores(user.id, engagementSince),
    listPostgresLikedListings(dataPlane, user.id),
    dataPlane.requestStore.listSavedFiltersByUserId(user.id),
    dataPlane.requestStore.listSavedSearchesByUserId(user.id),
    dataPlane.requestStore.getUserSettings(user.id),
    dataPlane.requestStore.listWatchlistsByUserId(user.id),
  ]);

  return {
    engagementByListingId,
    likedListings,
    savedFilters,
    savedSearches,
    settings,
    user,
    watchlists,
  };
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

  if (resolvePersistenceDriver() !== "postgres") {
    rememberListings(providerListings);
  }
  rememberAnalyticsListings(providerListings);

  const personalizationInputs = query.userId
    ? await loadPersonalizationInputs(query.userId)
    : undefined;
  const user = personalizationInputs?.user;
  const listings = await applyDisplayCurrency(
    providerListings,
    user?.currencyPreference,
  );

  if (personalizationInputs === undefined || user === undefined) {
    const recommendation = getMlRecommendationRuntime().rank({
      includeDebug: Boolean(query.debugPersonalization),
      listings,
      userId: "anonymous",
    });

    return {
      listings: recommendation.listings,
      isPersonalized: recommendation.isPersonalized,
      pagination: execution.pagination,
      personalizationSummary: recommendation.personalizationSummary,
      providers: execution.providers,
      debugPersonalization: recommendation.debugPersonalization,
      recommendation: recommendation.recommendation,
    };
  }

  const personalizationProfile = buildPersonalizationProfile({
    likedListings: personalizationInputs.likedListings,
    savedFilters: personalizationInputs.savedFilters,
    savedSearches: personalizationInputs.savedSearches,
    settings: personalizationInputs.settings,
    user,
    watchlists: personalizationInputs.watchlists,
  });
  const recommendation = getMlRecommendationRuntime().rank({
    engagementByListingId: personalizationInputs.engagementByListingId,
    listings,
    profile: personalizationProfile,
    includeDebug: Boolean(query.debugPersonalization),
    userId: user.id,
  });

  return {
    listings: recommendation.listings,
    isPersonalized: recommendation.isPersonalized,
    pagination: execution.pagination,
    personalizationSummary: recommendation.personalizationSummary,
    providers: execution.providers,
    debugPersonalization: recommendation.debugPersonalization,
    recommendation: recommendation.recommendation,
  };
}
