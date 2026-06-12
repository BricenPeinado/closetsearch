import { mockProvider } from "@closetsearch/providers";
import type { Provider } from "@closetsearch/providers";
import type { FeedQuery, FeedResponse, Listing, SearchQuery } from "@closetsearch/shared";
import { getLikesByUserId } from "./like-service.js";
import { getUserById } from "./user-service.js";
import { recordListingImpressions } from "./services/engagementService.js";
import { rememberListings } from "./services/listingCatalogService.js";
import { generateRiskSignal } from "./services/riskService.js";
import {
  hasPersonalizationSignals,
  rankListings,
} from "./services/recommendationService.js";

const developmentProviders: Provider[] = [mockProvider];
const defaultFeedSort: SearchQuery["sort"] = "newest";

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

export async function getFeed(query: FeedQuery): Promise<FeedResponse> {
  const providerResponses = await Promise.all(
    developmentProviders.map((provider) =>
      provider.search({
        text: "",
        sort: defaultFeedSort,
      }),
    ),
  );

  const listings: Listing[] = [];

  for (const response of providerResponses) {
    if (response.status === "success") {
      listings.push(...response.listings.map(attachRiskSignal));
    }
  }

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
  const startIndex = (query.page - 1) * query.pageSize;
  const endIndex = startIndex + query.pageSize;
  const paginatedListings = rankedListings.slice(startIndex, endIndex);
  const hasMore = endIndex < rankedListings.length;

  recordListingImpressions(paginatedListings);

  return {
    listings: paginatedListings,
    isPersonalized,
    page: query.page,
    pageSize: query.pageSize,
    total: rankedListings.length,
    hasMore,
    nextPage: hasMore ? query.page + 1 : undefined,
  };
}
