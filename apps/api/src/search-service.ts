import { mockProvider } from "@closetsearch/providers";
import type { Provider } from "@closetsearch/providers";
import type { Listing, SearchQuery, SearchResponse } from "@closetsearch/shared";
import { recordListingImpressions } from "./services/engagementService.js";
import { rememberListings } from "./services/listingCatalogService.js";

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
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? sortedListings.length;
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedListings = sortedListings.slice(startIndex, endIndex);
  const hasPaginatedResults = query.page !== undefined || query.pageSize !== undefined;
  const hasMoreResults = hasPaginatedResults ? endIndex < sortedListings.length : hasMore;
  const responseListings = hasPaginatedResults ? paginatedListings : sortedListings;

  rememberListings(responseListings);
  recordListingImpressions(responseListings);

  return {
    query,
    listings: responseListings,
    total: sortedListings.length,
    hasMore: hasMoreResults,
    nextCursor: hasPaginatedResults ? undefined : nextCursor,
    page: hasPaginatedResults ? page : undefined,
    pageSize: hasPaginatedResults ? pageSize : undefined,
    providers,
  };
}
