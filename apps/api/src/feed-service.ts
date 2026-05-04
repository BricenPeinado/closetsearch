import { mockProvider } from "@closetsearch/providers";
import type { Provider } from "@closetsearch/providers";
import type { FeedQuery, FeedResponse, Listing, SearchQuery } from "@closetsearch/shared";

const developmentProviders: Provider[] = [mockProvider];
const defaultFeedSort: SearchQuery["sort"] = "newest";

function sortListings(listings: Listing[]) {
  return [...listings].sort(
    (left, right) =>
      new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime(),
  );
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
      listings.push(...response.listings);
    }
  }

  const sortedListings = sortListings(listings);
  const startIndex = (query.page - 1) * query.pageSize;
  const endIndex = startIndex + query.pageSize;
  const paginatedListings = sortedListings.slice(startIndex, endIndex);
  const hasMore = endIndex < sortedListings.length;

  return {
    listings: paginatedListings,
    page: query.page,
    pageSize: query.pageSize,
    total: sortedListings.length,
    hasMore,
    nextPage: hasMore ? query.page + 1 : undefined,
  };
}
