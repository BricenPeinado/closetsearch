import type {
  AnalyticsDisclaimer,
  AnalyticsOverview,
  ListingCondition,
  ListingType,
  PriceSnapshot,
} from "@closetsearch/shared";
import type { QueryResultRow } from "pg";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import {
  buildBrandMarketSummaries,
  buildCategoryMarketSummaries,
  buildUnderMarketSignals,
  getMinimumComparableSampleSize,
} from "./marketRangeService.js";

interface SnapshotRow extends QueryResultRow {
  analytics_eligible: boolean;
  category: string | null;
  condition: string | null;
  image_url: string | null;
  last_seen_at: Date | string;
  listing_type: string;
  market_status: string;
  normalized_currency: string;
  normalized_price_minor: string | number | bigint;
  observation_id: string;
  observation_version: string | number | bigint;
  observed_at: Date | string;
  original_currency: string;
  original_price_minor: string | number | bigint;
  provider_brand: string | null;
  provider_id: string;
  source_listing_id: string;
  source_url: string;
  size: string | null;
  title: string;
}

const analyticsDisclaimers: AnalyticsDisclaimer[] = [
  {
    label: "Observed data only",
    text: "Ranges use normalized marketplace observations; sold and asking prices remain distinct.",
  },
  {
    label: "Not financial advice",
    text: "This pricing context is not financial advice.",
  },
  {
    label: "Not a prediction",
    text: "Observed ranges do not guarantee a sale price or future value.",
  },
  {
    label: "Provider coverage varies",
    text: "Availability, sold-price access, and update timing differ by marketplace.",
  },
];

function asIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const zeroFractionCurrencies = new Set(["CLP", "JPY", "KRW", "VND"]);
const threeFractionCurrencies = new Set(["BHD", "IQD", "JOD", "KWD", "OMR", "TND"]);

function currencyFractionDigits(currency: string) {
  if (zeroFractionCurrencies.has(currency)) {
    return 0;
  }

  return threeFractionCurrencies.has(currency) ? 3 : 2;
}

function moneyMajorUnits(value: string | number | bigint, currency: string) {
  const minor = Number(value);

  if (!Number.isSafeInteger(minor)) {
    return undefined;
  }

  return minor / 10 ** currencyFractionDigits(currency);
}

function listingType(value: string): ListingType {
  return value === "auction" || value === "buy_now" ? value : "unknown";
}

function condition(value: string | null): ListingCondition | undefined {
  switch (value) {
    case "new_with_tags":
    case "new_without_tags":
    case "excellent":
    case "good":
    case "fair":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

function mapSnapshot(row: SnapshotRow): PriceSnapshot | undefined {
  const priceAmount = moneyMajorUnits(row.original_price_minor, row.original_currency);
  const normalizedPriceAmount = moneyMajorUnits(
    row.normalized_price_minor,
    row.normalized_currency,
  );

  if (
    priceAmount === undefined ||
    normalizedPriceAmount === undefined ||
    (row.market_status !== "active" && row.market_status !== "sold")
  ) {
    return undefined;
  }

  return {
    brand: row.provider_brand ?? "Unknown brand",
    category: row.category ?? undefined,
    condition: condition(row.condition),
    id: row.observation_id,
    imageUrl: row.image_url ?? undefined,
    lastSeenAt: asIsoString(row.last_seen_at),
    listingId: `${row.provider_id}:${row.source_listing_id}`,
    listingType: listingType(row.listing_type),
    marketStatus: row.market_status,
    normalizedPriceAmount,
    normalizedPriceCurrency: row.normalized_currency,
    observationSequence: Number(row.observation_version),
    observedAt: asIsoString(row.observed_at),
    priceAmount,
    priceCurrency: row.original_currency,
    size: row.size ?? undefined,
    source: row.provider_id,
    sourceListingId: row.source_listing_id,
    sourceUrl: row.source_url,
    title: row.title,
  };
}

function latestObservationAt(snapshots: PriceSnapshot[]) {
  return snapshots
    .map((snapshot) => snapshot.lastSeenAt)
    .sort()
    .at(-1);
}

function unique(values: Array<string | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]),
  ).sort();
}

type ComparableBasis = "confirmed_sold" | "observed_asking";

function comparableGroupKey(
  snapshot: PriceSnapshot,
  getDimension: (snapshot: PriceSnapshot) => string | undefined,
) {
  const dimension = getDimension(snapshot)?.trim().toLowerCase();

  return dimension
    ? `${dimension}\u0000${snapshot.normalizedPriceCurrency.trim().toUpperCase()}`
    : undefined;
}

function selectSoldFirstBySegment(
  snapshots: PriceSnapshot[],
  getDimension: (snapshot: PriceSnapshot) => string | undefined,
) {
  const groups = new Map<string, PriceSnapshot[]>();

  for (const snapshot of snapshots) {
    const key = comparableGroupKey(snapshot, getDimension);

    if (!key) {
      continue;
    }

    const group = groups.get(key);

    if (group) {
      group.push(snapshot);
    } else {
      groups.set(key, [snapshot]);
    }
  }

  return Array.from(groups.values()).flatMap((group) => {
    const sold = group.filter((snapshot) => snapshot.marketStatus === "sold");
    return sold.length > 0 ? sold : group.filter((snapshot) => snapshot.marketStatus === "active");
  });
}

function basisForSummary(
  snapshots: PriceSnapshot[],
  label: string,
  currency: string,
  getDimension: (snapshot: PriceSnapshot) => string | undefined,
): ComparableBasis {
  const normalizedLabel = label.trim().toLowerCase();
  const normalizedCurrency = currency.trim().toUpperCase();

  return snapshots.some(
    (snapshot) =>
      snapshot.marketStatus === "sold" &&
      getDimension(snapshot)?.trim().toLowerCase() === normalizedLabel &&
      snapshot.normalizedPriceCurrency.trim().toUpperCase() === normalizedCurrency,
  )
    ? "confirmed_sold"
    : "observed_asking";
}

export class PostgresObservedAnalyticsService {
  constructor(private readonly dataPlane: PostgresDataPlane) {}

  async listLatestSnapshots() {
    const result = await this.dataPlane.database.query<SnapshotRow>(
      `SELECT
         po.observation_id,
         po.observation_version,
         l.provider_id,
         l.source_listing_id,
         l.provider_brand,
         l.category,
         l.condition,
         l.size,
         l.listing_type,
         l.title,
         l.source_url,
         po.original_price_minor,
         po.original_currency,
         l.analytics_eligible,
         state.last_seen_at,
         po.market_status,
         po.observed_at,
         COALESCE(
           CASE
             WHEN po.market_status = 'sold' THEN po.sold_price_minor
             ELSE NULL
           END,
           po.comparison_price_minor,
           po.original_price_minor
         ) AS normalized_price_minor,
         COALESCE(
           CASE
             WHEN po.market_status = 'sold' THEN po.sold_currency
             ELSE NULL
           END,
           po.comparison_currency,
           po.original_currency
         ) AS normalized_currency,
         image.image_url
       FROM price_observations po
       JOIN (
         SELECT listing_id, MAX(observation_version) AS observation_version
         FROM price_observations
         GROUP BY listing_id
       ) latest
         ON latest.listing_id = po.listing_id
        AND latest.observation_version = po.observation_version
       JOIN listings l ON l.id = po.listing_id
       JOIN listing_current_state state ON state.listing_id = l.id
       LEFT JOIN listing_images image
         ON image.listing_id = l.id
        AND image.ordinal = 0
       WHERE l.analytics_eligible = TRUE
         AND po.market_status IN ('active', 'sold')
         AND state.market_status = po.market_status
         AND (
           (po.market_status = 'active' AND state.availability = 'available')
           OR
           (po.market_status = 'sold' AND state.availability = 'sold')
         )
       ORDER BY po.observation_version DESC`,
    );

    return result.rows
      .map(mapSnapshot)
      .filter((snapshot): snapshot is PriceSnapshot => snapshot !== undefined);
  }

  async getOverview(): Promise<
    AnalyticsOverview & {
      askingComparableCount: number;
      soldComparableCount: number;
      sourceCoverage: string[];
    }
  > {
    const snapshots = await this.listLatestSnapshots();
    const active = snapshots.filter((snapshot) => snapshot.marketStatus === "active");
    const sold = snapshots.filter((snapshot) => snapshot.marketStatus === "sold");
    const comparableSnapshots = selectSoldFirstBySegment(
      snapshots,
      (snapshot) => `${snapshot.brand ?? ""}\u0000${snapshot.category ?? ""}`,
    );
    const sampleSizeThreshold = getMinimumComparableSampleSize();
    const comparableCount = comparableSnapshots.length;

    return {
      askingComparableCount: active.length,
      dataQuality:
        comparableCount === 0
          ? {
              comparableListingCount: 0,
              note: "No eligible marketplace observations are available yet.",
              sampleSizeThreshold,
              status: "empty",
            }
          : comparableCount < sampleSizeThreshold
            ? {
                comparableListingCount: comparableCount,
                note: "Observed data is limited; estimates remain gated until enough same-currency comparables exist.",
                sampleSizeThreshold,
                status: "limited",
              }
            : {
                comparableListingCount: comparableCount,
                note:
                  sold.length > 0 && active.length > 0
                    ? "Each same-currency segment prioritizes confirmed sold observations and falls back to labeled asking prices only where sold data is unavailable."
                    : sold.length > 0
                      ? "Ranges use confirmed sold observations and keep asking prices separate."
                      : "Sold access is unavailable; ranges use clearly labeled observed asking prices.",
                sampleSizeThreshold,
                status: "observed",
              },
      disclaimers: analyticsDisclaimers,
      latestObservationAt: latestObservationAt(snapshots),
      observedBrandCount: unique(snapshots.map((snapshot) => snapshot.brand)).length,
      observedCategoryCount: unique(snapshots.map((snapshot) => snapshot.category)).length,
      observedListingCount: snapshots.length,
      soldComparableCount: sold.length,
      sourceCoverage: unique(snapshots.map((snapshot) => snapshot.source)),
      underMarketSignalCount: buildUnderMarketSignals(active).length,
    };
  }

  async getMarketInsights() {
    const snapshots = await this.listLatestSnapshots();
    const brandComparables = selectSoldFirstBySegment(snapshots, (snapshot) => snapshot.brand);
    const categoryComparables = selectSoldFirstBySegment(
      snapshots,
      (snapshot) => snapshot.category,
    );
    const comparables = Array.from(
      new Map(
        [...brandComparables, ...categoryComparables].map((snapshot) => [snapshot.id, snapshot]),
      ).values(),
    );
    const hasSoldComparables = comparables.some((snapshot) => snapshot.marketStatus === "sold");
    const hasAskingComparables = comparables.some((snapshot) => snapshot.marketStatus === "active");

    return {
      basis:
        hasSoldComparables && hasAskingComparables
          ? ("segment_sold_first" as const)
          : hasSoldComparables
            ? ("confirmed_sold" as const)
            : ("asking_fallback" as const),
      brandSummaries: buildBrandMarketSummaries(brandComparables)
        .map((summary) => ({
          ...summary,
          basis: basisForSummary(
            brandComparables,
            summary.brand,
            summary.range.currency,
            (snapshot) => snapshot.brand,
          ),
        }))
        .slice(0, 8),
      categorySummaries: buildCategoryMarketSummaries(categoryComparables)
        .map((summary) => ({
          ...summary,
          basis: basisForSummary(
            categoryComparables,
            summary.category,
            summary.range.currency,
            (snapshot) => snapshot.category,
          ),
        }))
        .slice(0, 8),
      comparableCount: comparables.length,
      dataFreshnessAt: latestObservationAt(comparables),
      sourceCoverage: unique(comparables.map((snapshot) => snapshot.source)),
    };
  }

  async getUnderpricedSignals() {
    const snapshots = await this.listLatestSnapshots();
    const active = snapshots.filter((snapshot) => snapshot.marketStatus === "active");

    return {
      basis: "observed_asking" as const,
      disclaimer:
        "Signals compare observed asking prices only and do not imply guaranteed resale value or profit.",
      signals: buildUnderMarketSignals(active).slice(0, 12),
      sourceCoverage: unique(active.map((snapshot) => snapshot.source)),
    };
  }
}
