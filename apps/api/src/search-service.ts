import type { Listing, SearchQuery, SearchResponse } from "@closetsearch/shared";
import { createProviderRuntime, type ProviderRuntime } from "./providers/registry.js";
import { runProviderSearch } from "./providers/orchestrator.js";
import { recordListingImpressions } from "./services/engagementService.js";
import { rememberListings } from "./services/listingCatalogService.js";
import { generateRiskSignal } from "./services/riskService.js";

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

function attachRiskSignal(listing: Listing): Listing {
  return {
    ...listing,
    riskSignal: generateRiskSignal(listing),
  };
}

export async function searchListings(
  query: SearchQuery,
  runtime: ProviderRuntime = createProviderRuntime(),
): Promise<SearchResponse> {
  const execution = await runProviderSearch(query, runtime);
  const sortedListings = sortListings(execution.listings.map(attachRiskSignal), query.sort);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? sortedListings.length;
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedListings = sortedListings.slice(startIndex, endIndex);
  const hasPaginatedResults = query.page !== undefined || query.pageSize !== undefined;
  const hasMoreResults = hasPaginatedResults ? endIndex < sortedListings.length : execution.hasMore;
  const responseListings = hasPaginatedResults ? paginatedListings : sortedListings;

  rememberListings(responseListings);
  recordListingImpressions(responseListings);

  return {
    query,
    listings: responseListings,
    total: sortedListings.length,
    hasMore: hasMoreResults,
    nextCursor: hasPaginatedResults ? undefined : execution.nextCursor,
    page: hasPaginatedResults ? page : undefined,
    pageSize: hasPaginatedResults ? pageSize : undefined,
    providers: execution.providers,
  };
}
