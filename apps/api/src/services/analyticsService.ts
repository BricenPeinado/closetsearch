import type {
  AnalyticsDisclaimer,
  AnalyticsOverview,
  BrandMarketSummary,
  CategoryMarketSummary,
} from "@closetsearch/shared";
import {
  buildBrandMarketSummaries,
  buildCategoryMarketSummaries,
  buildUnderMarketSignals,
  getMinimumComparableSampleSize,
} from "./marketRangeService.js";
import { getLatestObservedPriceSnapshots } from "./priceSnapshotService.js";

interface MarketInsights {
  brandSummaries: BrandMarketSummary[];
  categorySummaries: CategoryMarketSummary[];
}

const analyticsDisclaimers: AnalyticsDisclaimer[] = [
  {
    label: "Observed data only",
    text: "Based on listings ClosetSearch has observed.",
  },
  {
    label: "Not financial advice",
    text: "This pricing context is not financial advice.",
  },
  {
    label: "Not a prediction",
    text: "Observed ranges describe past and current listings, not future prices.",
  },
  {
    label: "Availability changes",
    text: "Availability and prices may change as listings update or disappear.",
  },
];

function getObservedSnapshots() {
  return getLatestObservedPriceSnapshots();
}

function getActiveObservedSnapshots() {
  return getObservedSnapshots().filter((snapshot) => snapshot.marketStatus === "active");
}

function getLatestObservationAt() {
  const snapshots = getObservedSnapshots();

  if (snapshots.length === 0) {
    return undefined;
  }

  return snapshots.reduce((latest, snapshot) => {
    return new Date(snapshot.lastSeenAt).getTime() > new Date(latest).getTime()
      ? snapshot.lastSeenAt
      : latest;
  }, snapshots[0].lastSeenAt);
}

function countUniqueValues(values: Array<string | undefined>) {
  return new Set(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  ).size;
}

export function analyticsUsesSampleData() {
  const snapshots = getObservedSnapshots();
  return snapshots.length > 0 && snapshots.every((snapshot) => snapshot.source === "mock");
}

export function getAnalyticsOverview(): AnalyticsOverview {
  const snapshots = getObservedSnapshots();
  const activeSnapshots = getActiveObservedSnapshots();
  const underMarketSignals = buildUnderMarketSignals(activeSnapshots);
  const sampleSizeThreshold = getMinimumComparableSampleSize();

  const dataQuality =
    snapshots.length === 0
      ? {
          comparableListingCount: 0,
          note: "ClosetSearch has not observed enough listings yet to show pricing context.",
          sampleSizeThreshold,
          status: "empty" as const,
        }
      : activeSnapshots.length < sampleSizeThreshold
      ? {
          comparableListingCount: activeSnapshots.length,
          note: "Observed data is still limited. Similar-listing signals appear after enough same-currency listings are seen.",
          sampleSizeThreshold,
          status: "limited" as const,
        }
      : {
          comparableListingCount: activeSnapshots.length,
          note: "Ranges use observed listings grouped by matching brand, category, and currency when possible.",
          sampleSizeThreshold,
          status: "observed" as const,
        };

  return {
    dataQuality,
    disclaimers: analyticsDisclaimers,
    latestObservationAt: getLatestObservationAt(),
    observedBrandCount: countUniqueValues(snapshots.map((snapshot) => snapshot.brand)),
    observedCategoryCount: countUniqueValues(snapshots.map((snapshot) => snapshot.category)),
    observedListingCount: snapshots.length,
    underMarketSignalCount: underMarketSignals.length,
  };
}

export function getMarketInsights(): MarketInsights {
  const activeSnapshots = getActiveObservedSnapshots();

  return {
    brandSummaries: buildBrandMarketSummaries(activeSnapshots).slice(0, 8),
    categorySummaries: buildCategoryMarketSummaries(activeSnapshots).slice(0, 8),
  };
}

export function getUnderpricedListingSignals() {
  return buildUnderMarketSignals(getActiveObservedSnapshots()).slice(0, 12);
}
