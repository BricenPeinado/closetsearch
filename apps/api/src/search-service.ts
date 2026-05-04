import { mockProvider } from "@closetsearch/providers";
import type { Provider } from "@closetsearch/providers";
import type { Listing, SearchQuery, SearchResponse } from "@closetsearch/shared";

const developmentProviders: Provider[] = [mockProvider];

function sortListings(listings: Listing[], sort: SearchQuery["sort"]) {
  const sorted = [...listings];

  switch (sort) {
    case "price_asc":
      sorted.sort((left, right) => left.price.amount - right.price.amount);
      break;
    case "price_desc":
      sorted.sort((left, right) => right.price.amount - left.price.amount);
      break;
    case "newest":
    case "relevance":
    default:
      sorted.sort(
        (left, right) =>
          new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime(),
      );
      break;
  }

  return sorted;
}

export async function searchListings(query: SearchQuery): Promise<SearchResponse> {
  const providerResponses = await Promise.all(
    developmentProviders.map(async (provider) => ({
      provider,
      response: await provider.search(query),
    })),
  );

  const listings: Listing[] = [];
  let hasMore = false;
  let nextCursor: string | undefined;

  const providers = providerResponses.map(({ provider, response }) => {
    if (response.status === "success") {
      listings.push(...response.listings);
      hasMore = hasMore || Boolean(response.hasMore);
      nextCursor ??= response.nextCursor;

      return {
        providerId: provider.id,
        providerName: provider.name,
        status: "success" as const,
        resultCount: response.listings.length,
      };
    }

    return {
      providerId: provider.id,
      providerName: provider.name,
      status: "failure" as const,
      resultCount: 0,
    };
  });

  const sortedListings = sortListings(listings, query.sort);

  return {
    query,
    listings: sortedListings,
    total: sortedListings.length,
    hasMore,
    nextCursor,
    providers,
  };
}
