import type { Listing, SearchQuery, SearchResponse } from "@closetsearch/shared";
import { ApiError } from "./api-error.js";
import { createProviderRuntime, type ProviderRuntime } from "./providers/registry.js";
import { runProviderSearch } from "./providers/orchestrator.js";
import { recordListingImpressions } from "./services/engagementService.js";
import { rememberListings } from "./services/listingCatalogService.js";
import { recordObservedListings } from "./services/priceSnapshotService.js";
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

function rememberAnalyticsListings(listings: Listing[]) {
  try {
    recordObservedListings(listings);
  } catch (error) {
    console.error("Analytics snapshot recording failed", {
      message: error instanceof Error ? error.message : "Unknown analytics snapshot error",
      route: "search",
    });
  }
}

function shouldThrowProviderUnavailable(
  providers: Array<{ status: "success" | "failure" }>,
  listings: Listing[],
) {
  return listings.length === 0 && providers.length > 0 && providers.every((provider) => provider.status === "failure");
}

export async function searchListings(
  query: SearchQuery,
  runtime: ProviderRuntime = createProviderRuntime(),
): Promise<SearchResponse> {
  const execution = await runProviderSearch(query, runtime);

  if (shouldThrowProviderUnavailable(execution.providers, execution.listings)) {
    throw new ApiError(502, "search_unavailable", "The search request could not be completed right now.");
  }

  const responseListings = sortListings(execution.listings.map(attachRiskSignal), query.sort);

  rememberListings(responseListings);
  rememberAnalyticsListings(responseListings);
  recordListingImpressions(responseListings);

  return {
    query: {
      ...query,
      cursor: undefined,
      page: execution.pagination.page,
      pageSize: execution.pagination.pageSize,
    },
    listings: responseListings,
    pagination: execution.pagination,
    providers: execution.providers,
  };
}
