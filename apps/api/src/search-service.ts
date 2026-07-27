import type { Listing, SearchQuery, SearchResponse } from "@closetsearch/shared";
import { ApiError } from "./api-error.js";
import { resolvePersistenceDriver } from "./db/persistence-driver.js";
import { logWarn } from "./logger.js";
import type { ProviderRuntime } from "./providers/registry.js";
import { runProviderSearch } from "./providers/orchestrator.js";
import { rememberListings } from "./services/listingCatalogService.js";
import { persistProviderListings } from "./services/providerListingPersistenceService.js";
import { recordObservedListings } from "./services/priceSnapshotService.js";
import { generateRiskSignal } from "./services/riskService.js";
import { applyDisplayCurrency } from "./services/exchangeRateService.js";
import { getMlRecommendationRuntime } from "./services/mlRecommendationRuntimeService.js";

function getComparisonMoney(listing: Listing) {
  return (
    listing.pricing?.display ??
    listing.pricing?.comparison ??
    listing.pricing?.original ??
    listing.price
  );
}

export function sortListingsForSearch(listings: Listing[], sort: SearchQuery["sort"]) {
  const sorted = [...listings];
  const comparisonCurrencies = new Set(
    sorted.map((listing) => getComparisonMoney(listing).currency.toUpperCase()),
  );
  const canComparePrices = comparisonCurrencies.size <= 1;
  const timestamp = (listing: Listing) =>
    new Date(
      listing.lifecycle?.sourceUpdatedAt ?? listing.lifecycle?.listedAt ?? listing.fetchedAt,
    ).getTime();
  const auctionEnd = (listing: Listing) => {
    const value = listing.auction?.endsAt;
    const end = value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
    return Number.isFinite(end) && end >= Date.now() ? end : Number.POSITIVE_INFINITY;
  };
  const popularity = (listing: Listing) => {
    const tagScore =
      listing.market?.tags?.filter((tag) => /popular|trending|watched|featured/i.test(tag))
        .length ?? 0;
    const feedbackScore = Math.log10(1 + (listing.seller?.feedbackCount ?? 0));
    const completeness =
      Math.min(4, listing.images?.length ?? (listing.imageUrl ? 1 : 0)) +
      (listing.description ? 1 : 0) +
      (listing.shipping ? 1 : 0);
    return tagScore * 10 + feedbackScore + completeness + (listing.market?.priceDropsCount ?? 0);
  };

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
    case "ending_soon":
      sorted.sort(
        (left, right) =>
          auctionEnd(left) - auctionEnd(right) ||
          timestamp(right) - timestamp(left) ||
          left.id.localeCompare(right.id),
      );
      break;
    case "popularity":
      sorted.sort(
        (left, right) =>
          popularity(right) - popularity(left) ||
          timestamp(right) - timestamp(left) ||
          left.id.localeCompare(right.id),
      );
      break;
    case "recommended":
      break;
    case "newest":
    case "relevance":
    default:
      sorted.sort(
        (left, right) => timestamp(right) - timestamp(left) || left.id.localeCompare(right.id),
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
  if (resolvePersistenceDriver() === "postgres") {
    return;
  }

  try {
    recordObservedListings(listings);
  } catch (error) {
    logWarn("Analytics snapshot recording failed", {
      errorName: error instanceof Error ? error.name : "UnknownAnalyticsSnapshotError",
      route: "search",
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

export async function searchListings(
  query: SearchQuery,
  runtime: ProviderRuntime,
): Promise<SearchResponse> {
  const execution = await runProviderSearch(query, runtime);

  if (shouldThrowProviderUnavailable(execution.providers, execution.listings)) {
    throw new ApiError(
      502,
      "search_unavailable",
      "The search request could not be completed right now.",
    );
  }

  const providerListings = execution.listings.map(attachRiskSignal);
  const displayListings = await applyDisplayCurrency(providerListings, query.currency);
  const responseListings =
    query.sort === "recommended"
      ? getMlRecommendationRuntime().rank({
          listings: displayListings,
          userId: "anonymous-search",
        }).listings
      : sortListingsForSearch(displayListings, query.sort);

  if (resolvePersistenceDriver() !== "postgres") {
    rememberListings(providerListings);
  } else {
    await persistProviderListings(providerListings);
  }
  rememberAnalyticsListings(providerListings);

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
