import type { FeedQuery, FeedResponse, Listing, SearchQuery } from "@closetsearch/shared";
import { ApiError } from "./api-error.js";
import { createProviderRuntime, type ProviderRuntime } from "./providers/registry.js";
import { runProviderSearch } from "./providers/orchestrator.js";
import { getLikesByUserId } from "./like-service.js";
import { getUserById } from "./user-service.js";
import { recordListingImpressions } from "./services/engagementService.js";
import { rememberListings } from "./services/listingCatalogService.js";
import { generateRiskSignal } from "./services/riskService.js";
import {
  hasPersonalizationSignals,
  rankListings,
} from "./services/recommendationService.js";

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

function shouldThrowProviderUnavailable(
  providers: Array<{ status: "success" | "failure" }>,
  listings: Listing[],
) {
  return listings.length === 0 && providers.length > 0 && providers.every((provider) => provider.status === "failure");
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

  const listings = execution.listings.map(attachRiskSignal);

  rememberListings(listings);

  const user = query.userId ? getUserById(query.userId) : undefined;
  const likes = user ? getLikesByUserId(user.id) : [];
  const isPersonalized = user
    ? hasPersonalizationSignals(likes, user.onboardingPreferences)
    : false;
  const rankedListings = user
    ? rankListings({
        listings,
        user,
        likes,
        onboardingPreferences: user.onboardingPreferences,
      })
    : sortListings(listings);

  recordListingImpressions(rankedListings);

  return {
    listings: rankedListings,
    isPersonalized,
    pagination: execution.pagination,
  };
}
