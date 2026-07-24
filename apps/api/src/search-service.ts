import type { Listing, SearchQuery, SearchResponse } from "@closetsearch/shared";
import { ApiError } from "./api-error.js";
import { logWarn } from "./logger.js";
import { createProviderRuntime, type ProviderRuntime } from "./providers/registry.js";
import { runProviderSearch } from "./providers/orchestrator.js";
import { recordListingImpressions } from "./services/engagementService.js";
import { rememberListings } from "./services/listingCatalogService.js";
import { recordObservedListings } from "./services/priceSnapshotService.js";
import { generateRiskSignal } from "./services/riskService.js";
import { applyDisplayCurrency } from "./services/exchangeRateService.js";

function getComparisonMoney(listing: Listing) {
  return (
    listing.pricing?.display ??
    listing.pricing?.comparison ??
    listing.pricing?.original ??
    listing.price
  );
}

export function sortListingsForSearch(
  listings: Listing[],
  sort: SearchQuery["sort"],
) {
  const sorted = [...listings];
  const comparisonCurrencies = new Set(
    sorted.map((listing) => getComparisonMoney(listing).currency.toUpperCase()),
  );
  const canComparePrices = comparisonCurrencies.size <= 1;

  switch (sort) {
    case "price_asc":
      if (canComparePrices) {
        sorted.sort(
          (left, right) =>
            getComparisonMoney(left).amount - getComparisonMoney(right).amount ||
            left.id.localeCompare(right.id),
        );
      }
      break;
    case "price_desc":
      if (canComparePrices) {
        sorted.sort(
          (left, right) =>
            getComparisonMoney(right).amount - getComparisonMoney(left).amount ||
            left.id.localeCompare(right.id),
        );
      }
      break;
    case "newest":
    case "relevance":
    default:
      sorted.sort(
        (left, right) =>
          new Date(right.fetchedAt).getTime() -
            new Date(left.fetchedAt).getTime() ||
          left.id.localeCompare(right.id),
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
    logWarn("Analytics snapshot recording failed", {
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

  const providerListings = execution.listings.map(attachRiskSignal);
  const responseListings = sortListingsForSearch(
    await applyDisplayCurrency(providerListings, query.currency),
    query.sort,
  );

  rememberListings(providerListings);
  rememberAnalyticsListings(providerListings);
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
