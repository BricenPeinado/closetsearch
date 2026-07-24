import type {
  BrandMarketSummary,
  CategoryMarketSummary,
  ListingPriceComparison,
  PriceSnapshot,
  UnderpricedListingSignal,
  ObservedMarketRange,
} from "@closetsearch/shared";

const minimumComparableSampleSize = 4;
const nearObservedRangeRatio = 1.05;
const lowerThanMedianRatio = 0.9;

function normalizeToken(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  const midpoint = Math.floor(values.length / 2);

  if (values.length % 2 === 0) {
    return (values[midpoint - 1] + values[midpoint]) / 2;
  }

  return values[midpoint];
}

function quartile(values: number[], percentile: number) {
  if (values.length < 4) {
    return undefined;
  }

  const index = (values.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = values[lowerIndex];
  const upperValue = values[upperIndex];

  if (lowerValue === upperValue) {
    return lowerValue;
  }

  const remainder = index - lowerIndex;
  return lowerValue + (upperValue - lowerValue) * remainder;
}

function getLatestObservationAt(snapshots: PriceSnapshot[]) {
  return snapshots.reduce(
    (latest, snapshot) => {
      return new Date(snapshot.lastSeenAt).getTime() > new Date(latest).getTime()
        ? snapshot.lastSeenAt
        : latest;
    },
    snapshots[0]?.lastSeenAt ?? new Date(0).toISOString(),
  );
}

function buildRange(snapshots: PriceSnapshot[]) {
  if (snapshots.length === 0) {
    return undefined;
  }

  const sortedPrices = snapshots
    .map((snapshot) => snapshot.normalizedPriceAmount)
    .sort((left, right) => left - right);

  return {
    averagePrice: roundPrice(average(sortedPrices)),
    count: snapshots.length,
    currency: snapshots[0].normalizedPriceCurrency,
    latestObservationAt: getLatestObservationAt(snapshots),
    lowerQuartilePrice: roundPrice(quartile(sortedPrices, 0.25) ?? 0) || undefined,
    maxPrice: sortedPrices[sortedPrices.length - 1],
    medianPrice: roundPrice(median(sortedPrices)),
    minPrice: sortedPrices[0],
    upperQuartilePrice: roundPrice(quartile(sortedPrices, 0.75) ?? 0) || undefined,
  } satisfies ObservedMarketRange;
}

function buildGroupedSummaries<T extends BrandMarketSummary | CategoryMarketSummary>(
  snapshots: PriceSnapshot[],
  getKey: (snapshot: PriceSnapshot) => string | undefined,
  createSummary: (label: string, range: ObservedMarketRange) => T,
) {
  const groupedSnapshots = new Map<string, { label: string; snapshots: PriceSnapshot[] }>();

  for (const snapshot of snapshots) {
    const label = getKey(snapshot)?.trim();

    if (!label) {
      continue;
    }

    const key = [normalizeToken(label), snapshot.normalizedPriceCurrency.trim().toUpperCase()].join(
      "\u0000",
    );
    const existingGroup = groupedSnapshots.get(key);

    if (existingGroup) {
      existingGroup.snapshots.push(snapshot);
      continue;
    }

    groupedSnapshots.set(key, {
      label,
      snapshots: [snapshot],
    });
  }

  return Array.from(groupedSnapshots.values())
    .map((group) => {
      const range = buildRange(group.snapshots);
      return range ? createSummary(group.label, range) : undefined;
    })
    .filter((summary): summary is T => summary !== undefined)
    .sort((left, right) => {
      if (right.range.count === left.range.count) {
        const leftLabel = "brand" in left ? left.brand : left.category;
        const rightLabel = "brand" in right ? right.brand : right.category;
        return leftLabel.localeCompare(rightLabel);
      }

      return right.range.count - left.range.count;
    });
}

function buildBaseComparableSnapshots(target: PriceSnapshot, snapshots: PriceSnapshot[]) {
  const targetBrand = normalizeToken(target.brand);
  const targetCategory = normalizeToken(target.category);

  return snapshots.filter((snapshot) => {
    if (snapshot.listingId === target.listingId) {
      return false;
    }

    return (
      snapshot.marketStatus === "active" &&
      normalizeToken(snapshot.brand) === targetBrand &&
      normalizeToken(snapshot.category) === targetCategory &&
      snapshot.normalizedPriceCurrency === target.normalizedPriceCurrency
    );
  });
}

function buildComparisonResult(
  target: PriceSnapshot,
  comparableSnapshots: PriceSnapshot[],
  comparisonScope: string,
): ListingPriceComparison {
  if (target.normalizedPriceAmount <= 0) {
    return {
      comparableCount: 0,
      comparisonScope,
      currentCurrency: target.normalizedPriceCurrency,
      currentPrice: target.normalizedPriceAmount,
      label: "Limited data",
      listingId: target.listingId,
      message: "This listing is missing a usable observed price.",
      status: "missing_price",
    };
  }

  const observedRange = buildRange(comparableSnapshots);

  if (observedRange === undefined || comparableSnapshots.length < minimumComparableSampleSize) {
    return {
      comparableCount: comparableSnapshots.length,
      comparisonScope,
      currentCurrency: target.normalizedPriceCurrency,
      currentPrice: target.normalizedPriceAmount,
      label: "Not enough observed data",
      listingId: target.listingId,
      message: "ClosetSearch has not observed enough similar listings in the same currency yet.",
      observedRange,
      status: "limited_data",
    };
  }

  if (target.normalizedPriceAmount < observedRange.minPrice) {
    return {
      comparableCount: comparableSnapshots.length,
      comparisonScope,
      currentCurrency: target.normalizedPriceCurrency,
      currentPrice: target.normalizedPriceAmount,
      label: "Below observed range",
      listingId: target.listingId,
      message: "Priced lower than similar observed listings in ClosetSearch data.",
      observedRange,
      status: "observed",
    };
  }

  if (target.normalizedPriceAmount <= observedRange.medianPrice * lowerThanMedianRatio) {
    return {
      comparableCount: comparableSnapshots.length,
      comparisonScope,
      currentCurrency: target.normalizedPriceCurrency,
      currentPrice: target.normalizedPriceAmount,
      label: "Below observed median",
      listingId: target.listingId,
      message: "Priced lower than the observed median for similar listings.",
      observedRange,
      status: "observed",
    };
  }

  if (target.normalizedPriceAmount <= observedRange.medianPrice * nearObservedRangeRatio) {
    return {
      comparableCount: comparableSnapshots.length,
      comparisonScope,
      currentCurrency: target.normalizedPriceCurrency,
      currentPrice: target.normalizedPriceAmount,
      label: "Near observed range",
      listingId: target.listingId,
      message: "Close to the observed pricing range for similar listings.",
      observedRange,
      status: "observed",
    };
  }

  return {
    comparableCount: comparableSnapshots.length,
    comparisonScope,
    currentCurrency: target.normalizedPriceCurrency,
    currentPrice: target.normalizedPriceAmount,
    label: "Within observed range",
    listingId: target.listingId,
    message: "Within the observed pricing range for similar listings.",
    observedRange,
    status: "observed",
  };
}

export function getMinimumComparableSampleSize() {
  return minimumComparableSampleSize;
}

export function buildBrandMarketSummaries(snapshots: PriceSnapshot[]) {
  return buildGroupedSummaries(
    snapshots,
    (snapshot) => snapshot.brand,
    (brand, range) => ({
      brand,
      range,
    }),
  );
}

export function buildCategoryMarketSummaries(snapshots: PriceSnapshot[]) {
  return buildGroupedSummaries(
    snapshots,
    (snapshot) => snapshot.category,
    (category, range) => ({
      category,
      range,
    }),
  );
}

export function compareListingToObservedMarket(target: PriceSnapshot, snapshots: PriceSnapshot[]) {
  const targetBrand = normalizeToken(target.brand);
  const targetCategory = normalizeToken(target.category);

  if (targetBrand.length === 0 || targetCategory.length === 0) {
    return {
      comparableCount: 0,
      comparisonScope: "brand + category",
      currentCurrency: target.normalizedPriceCurrency,
      currentPrice: target.normalizedPriceAmount,
      label: "Not enough observed data",
      listingId: target.listingId,
      message: "ClosetSearch needs observed brand and category data before comparing this listing.",
      status: "limited_data",
    } satisfies ListingPriceComparison;
  }

  const sameBrandAndCategory = buildBaseComparableSnapshots(target, snapshots);

  if (sameBrandAndCategory.length === 0) {
    const crossCurrencyMatches = snapshots.filter((snapshot) => {
      return (
        snapshot.listingId !== target.listingId &&
        snapshot.marketStatus === "active" &&
        normalizeToken(snapshot.brand) === targetBrand &&
        normalizeToken(snapshot.category) === targetCategory
      );
    });

    if (crossCurrencyMatches.length > 0) {
      return {
        comparableCount: crossCurrencyMatches.length,
        comparisonScope: "brand + category",
        currentCurrency: target.normalizedPriceCurrency,
        currentPrice: target.normalizedPriceAmount,
        label: "Limited data",
        listingId: target.listingId,
        message:
          "Similar observed listings exist, but not enough share the same normalized currency.",
        status: "currency_mismatch",
      } satisfies ListingPriceComparison;
    }
  }

  const sameCondition = target.condition
    ? sameBrandAndCategory.filter((snapshot) => snapshot.condition === target.condition)
    : [];
  const sameListingType = sameBrandAndCategory.filter(
    (snapshot) => snapshot.listingType === target.listingType,
  );

  if (sameCondition.length >= minimumComparableSampleSize) {
    return buildComparisonResult(target, sameCondition, "brand + category + condition");
  }

  if (sameListingType.length >= minimumComparableSampleSize) {
    return buildComparisonResult(target, sameListingType, "brand + category + listing type");
  }

  return buildComparisonResult(target, sameBrandAndCategory, "brand + category");
}

export function buildUnderMarketSignals(snapshots: PriceSnapshot[]) {
  const signals: UnderpricedListingSignal[] = [];

  for (const snapshot of snapshots) {
    const comparison = compareListingToObservedMarket(snapshot, snapshots);
    const observedRange = comparison.observedRange;

    if (comparison.status !== "observed" || observedRange === undefined) {
      continue;
    }

    if (
      comparison.label !== "Below observed range" &&
      comparison.label !== "Below observed median" &&
      comparison.label !== "Near observed range"
    ) {
      continue;
    }

    const signalStrength =
      comparison.label === "Below observed range"
        ? "below_observed_range"
        : comparison.label === "Below observed median"
          ? "below_observed_median"
          : "near_observed_range";

    signals.push({
      brand: snapshot.brand,
      category: snapshot.category,
      comparableCount: comparison.comparableCount,
      comparisonScope: comparison.comparisonScope,
      currentCurrency: comparison.currentCurrency,
      currentPrice: comparison.currentPrice,
      id: `${snapshot.source}:${snapshot.sourceListingId}:${signalStrength}`,
      imageUrl: snapshot.imageUrl,
      label: comparison.label,
      listingId: snapshot.listingId,
      listingTitle: snapshot.title ?? "Observed listing",
      observedAt: snapshot.lastSeenAt,
      observedCurrency: observedRange.currency,
      observedMaxPrice: observedRange.maxPrice,
      observedMedianPrice: observedRange.medianPrice,
      observedMinPrice: observedRange.minPrice,
      signalStrength,
      source: snapshot.source,
      summary: comparison.message,
    });
  }

  return signals.sort((left, right) => {
    const currencyOrder = left.currentCurrency.localeCompare(right.currentCurrency);

    if (currencyOrder !== 0) {
      return currencyOrder;
    }

    const leftDelta = left.observedMedianPrice - left.currentPrice;
    const rightDelta = right.observedMedianPrice - right.currentPrice;

    if (rightDelta !== leftDelta) {
      return rightDelta - leftDelta;
    }

    return left.id.localeCompare(right.id);
  });
}
