import type { QueryResultRow } from "pg";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { parsePublicListingId } from "../db/postgres/public-listing-id.js";
import type { MarketStatus, PriceObservationKind } from "../db/postgres/model.js";

const maximumSeriesRows = 5_000;
const minimumStatisticalSampleSize = 4;

interface ListingRow extends QueryResultRow {
  analytics_eligible: boolean;
  id: string;
  provider_id: string;
  source_listing_id: string;
  source_marketplace: string;
}

interface PriceTrendRow extends QueryResultRow {
  auction_ends_at: Date | string | null;
  bid_count: number | null;
  buy_now_currency: string | null;
  buy_now_price_minor: string | number | bigint | null;
  comparison_currency: string | null;
  comparison_price_minor: string | number | bigint | null;
  completed_auction_currency: string | null;
  completed_auction_price_minor: string | number | bigint | null;
  current_bid_currency: string | null;
  current_bid_minor: string | number | bigint | null;
  landed_currency: string | null;
  landed_price_minor: string | number | bigint | null;
  market_status: MarketStatus;
  observation_kind: PriceObservationKind;
  observation_version: string | number | bigint;
  observed_at: Date | string;
  original_currency: string;
  original_price_minor: string | number | bigint;
  provider_id: string;
  shipping_currency: string | null;
  shipping_price_minor: string | number | bigint | null;
  sold_currency: string | null;
  sold_price_minor: string | number | bigint | null;
  source_marketplace: string;
}

export interface PriceTrendFilters {
  from?: Date;
  providerIds?: string[];
  to?: Date;
}

type TrendState = "analytics_excluded" | "insufficient_data" | "no_data" | "ready";

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeMinor(value: string | number | bigint | null) {
  if (value === null) {
    return undefined;
  }

  const parsed = typeof value === "bigint" ? value : BigInt(value);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : undefined;
}

function moneyForObservation(row: PriceTrendRow) {
  switch (row.observation_kind) {
    case "completed_auction":
      return {
        amountMinor:
          safeMinor(row.completed_auction_price_minor) ?? safeMinor(row.sold_price_minor),
        currency: row.completed_auction_currency ?? row.sold_currency ?? undefined,
      };
    case "confirmed_sold":
      return {
        amountMinor: safeMinor(row.sold_price_minor),
        currency: row.sold_currency ?? undefined,
      };
    case "current_bid":
      return {
        amountMinor: safeMinor(row.current_bid_minor) ?? safeMinor(row.original_price_minor),
        currency: row.current_bid_currency ?? row.original_currency,
      };
    case "asking":
      return {
        amountMinor: safeMinor(row.original_price_minor),
        currency: row.original_currency,
      };
  }
}

function percentile(sorted: number[], probability: number) {
  if (sorted.length === 0) {
    return undefined;
  }

  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] as number;
  const upper = sorted[upperIndex] as number;

  return Math.round(lower + (upper - lower) * (position - lowerIndex));
}

function countBy<T extends string>(values: T[], initial: Record<T, number>) {
  for (const value of values) {
    initial[value] = (initial[value] ?? 0) + 1;
  }

  return initial;
}

function percentageChange(latest: number, baseline: number) {
  if (baseline === 0) {
    return undefined;
  }

  return Math.round(((latest - baseline) / baseline) * 10_000) / 100;
}

function changes(
  observations: Array<{ amountMinor: number; observedAt: string }>,
  latest: { amountMinor: number; observedAt: string } | undefined,
) {
  const latestAt = latest ? new Date(latest.observedAt) : undefined;

  return Object.fromEntries(
    [7, 30, 90, 365].map((days) => {
      if (!latest || !latestAt) {
        return [`days${days}`, null];
      }

      const cutoff = latestAt.getTime() - days * 86_400_000;
      const baseline = observations
        .filter((observation) => new Date(observation.observedAt).getTime() <= cutoff)
        .at(-1);

      return [
        `days${days}`,
        baseline
          ? {
              absoluteMinor: latest.amountMinor - baseline.amountMinor,
              baselineAmountMinor: baseline.amountMinor,
              baselineObservedAt: baseline.observedAt,
              percent: percentageChange(latest.amountMinor, baseline.amountMinor),
            }
          : null,
      ];
    }),
  ) as Record<
    "days7" | "days30" | "days90" | "days365",
    {
      absoluteMinor: number;
      baselineAmountMinor: number;
      baselineObservedAt: string;
      percent?: number;
    } | null
  >;
}

function confidence(
  sampleSize: number,
  uniqueDays: number,
  ageSeconds: number,
  kinds: Set<PriceObservationKind>,
) {
  const sampleScore = Math.min(50, sampleSize * 4);
  const coverageScore = Math.min(25, uniqueDays * 2);
  const freshnessScore = ageSeconds <= 86_400 ? 20 : ageSeconds <= 604_800 ? 12 : 3;
  const evidenceScore = kinds.has("confirmed_sold") || kinds.has("completed_auction") ? 5 : 0;
  const score = Math.min(100, sampleScore + coverageScore + freshnessScore + evidenceScore);
  const reasons: string[] = [];

  if (sampleSize < minimumStatisticalSampleSize) {
    reasons.push("fewer_than_four_same_currency_observations");
  }
  if (uniqueDays < 3) {
    reasons.push("limited_time_coverage");
  }
  if (ageSeconds > 604_800) {
    reasons.push("latest_observation_is_stale");
  }
  if (!kinds.has("confirmed_sold") && !kinds.has("completed_auction")) {
    reasons.push("no_confirmed_sale_evidence");
  }

  return {
    level: score >= 75 ? ("high" as const) : score >= 40 ? ("medium" as const) : ("low" as const),
    reasons,
    score,
  };
}

async function resolveListing(
  dataPlane: PostgresDataPlane,
  listingId: string,
): Promise<ListingRow | undefined> {
  const publicIdentity = parsePublicListingId(listingId);
  const result = publicIdentity
    ? await dataPlane.database.query<ListingRow>(
        `SELECT id, provider_id, source_listing_id, source_marketplace, analytics_eligible
         FROM listings
         WHERE provider_id = $1 AND source_listing_id = $2`,
        [publicIdentity.providerId, publicIdentity.sourceListingId],
      )
    : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(listingId)
      ? await dataPlane.database.query<ListingRow>(
          `SELECT id, provider_id, source_listing_id, source_marketplace, analytics_eligible
           FROM listings
           WHERE id = $1`,
          [listingId],
        )
      : undefined;

  return result?.rows[0];
}

export class PriceTrendService {
  constructor(
    private readonly dataPlane: PostgresDataPlane,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getListingTrend(listingId: string, filters: PriceTrendFilters = {}) {
    const listing = await resolveListing(this.dataPlane, listingId);

    if (!listing) {
      return undefined;
    }

    if (!listing.analytics_eligible) {
      return {
        counts: {
          byMarketStatus: { active: 0, sold: 0, unknown: 0 },
          byMarketplace: {},
          byObservationKind: {
            asking: 0,
            completed_auction: 0,
            confirmed_sold: 0,
            current_bid: 0,
          },
        },
        filters: {
          from: filters.from?.toISOString(),
          providers: Array.from(
            new Set(
              filters.providerIds?.map((value) => value.trim().toLowerCase()).filter(Boolean),
            ),
          ),
          to: filters.to?.toISOString(),
        },
        listingId: `${listing.provider_id}:${listing.source_listing_id}`,
        series: [],
        state: "analytics_excluded" as const,
        summary: {
          changes: {
            days7: null,
            days30: null,
            days90: null,
            days365: null,
          },
          confidence: {
            level: "low" as const,
            reasons: ["listing_not_analytics_eligible"],
            score: 0,
          },
          excludedCurrencyCount: 0,
          inlierCount: 0,
          outlierCount: 0,
          sampleSize: 0,
          uniqueDayCount: 0,
        },
        truncated: false,
      };
    }

    const normalizedProviders = Array.from(
      new Set(filters.providerIds?.map((value) => value.trim().toLowerCase()).filter(Boolean)),
    );
    const providerExcluded =
      normalizedProviders.length > 0 && !normalizedProviders.includes(listing.provider_id);
    const parameters: unknown[] = [listing.id];
    const predicates = ["po.listing_id = $1", "po.analytics_eligible = TRUE"];

    if (filters.from) {
      parameters.push(filters.from);
      predicates.push(`po.observed_at >= $${parameters.length}`);
    }
    if (filters.to) {
      parameters.push(filters.to);
      predicates.push(`po.observed_at <= $${parameters.length}`);
    }

    const result = providerExcluded
      ? { rows: [] as PriceTrendRow[] }
      : await this.dataPlane.database.query<PriceTrendRow>(
          `SELECT
             po.observation_version,
             po.observation_kind,
             po.market_status,
             po.observed_at,
             po.original_price_minor,
             po.original_currency,
             po.comparison_price_minor,
             po.comparison_currency,
             po.sold_price_minor,
             po.sold_currency,
             po.shipping_price_minor,
             po.shipping_currency,
             po.landed_price_minor,
             po.landed_currency,
             po.current_bid_minor,
             po.current_bid_currency,
             po.completed_auction_price_minor,
             po.completed_auction_currency,
             po.buy_now_price_minor,
             po.buy_now_currency,
             po.bid_count,
             po.auction_ends_at,
             COALESCE(po.provider_id, listing.provider_id) AS provider_id,
             COALESCE(
               po.source_marketplace,
               listing.source_marketplace
             ) AS source_marketplace
           FROM price_observations po
           JOIN listings listing ON listing.id = po.listing_id
           WHERE ${predicates.join(" AND ")}
           ORDER BY po.observed_at, po.observation_version
           LIMIT ${maximumSeriesRows + 1}`,
          parameters,
        );
    const truncated = result.rows.length > maximumSeriesRows;
    const rows = result.rows.slice(0, maximumSeriesRows);
    const series = rows.map((row) => {
      const primary = moneyForObservation(row);

      return {
        amountMinor: primary.amountMinor,
        auctionEndsAt: row.auction_ends_at ? toIso(row.auction_ends_at) : undefined,
        bidCount: row.bid_count ?? undefined,
        buyNowPriceMinor: safeMinor(row.buy_now_price_minor),
        comparisonCurrency: row.comparison_currency ?? undefined,
        comparisonPriceMinor: safeMinor(row.comparison_price_minor),
        currency: primary.currency,
        landedCurrency: row.landed_currency ?? undefined,
        landedPriceMinor: safeMinor(row.landed_price_minor),
        marketStatus: row.market_status,
        marketplace: row.source_marketplace,
        observationKind: row.observation_kind,
        observationVersion: Number(row.observation_version),
        observedAt: toIso(row.observed_at),
        providerId: row.provider_id,
        shippingCurrency: row.shipping_currency ?? undefined,
        shippingPriceMinor: safeMinor(row.shipping_price_minor),
      };
    });
    const latestCurrency = [...series]
      .reverse()
      .find((entry) => entry.amountMinor !== undefined && entry.currency)?.currency;
    const statisticalSeries = series.filter(
      (entry): entry is typeof entry & { amountMinor: number; currency: string } =>
        entry.amountMinor !== undefined && entry.currency === latestCurrency,
    );
    const sortedAmounts = statisticalSeries
      .map((entry) => entry.amountMinor)
      .sort((left, right) => left - right);
    const q1Minor = percentile(sortedAmounts, 0.25);
    const q3Minor = percentile(sortedAmounts, 0.75);
    const iqrMinor = q1Minor === undefined || q3Minor === undefined ? undefined : q3Minor - q1Minor;
    const lowerFenceMinor =
      q1Minor === undefined || iqrMinor === undefined
        ? undefined
        : Math.max(0, Math.round(q1Minor - 1.5 * iqrMinor));
    const upperFenceMinor =
      q3Minor === undefined || iqrMinor === undefined
        ? undefined
        : Math.round(q3Minor + 1.5 * iqrMinor);
    const outlierCount =
      lowerFenceMinor === undefined || upperFenceMinor === undefined
        ? 0
        : sortedAmounts.filter((amount) => amount < lowerFenceMinor || amount > upperFenceMinor)
            .length;
    const latest = statisticalSeries.at(-1);
    const latestObservedAt = rows.at(-1)?.observed_at;
    const ageSeconds = latestObservedAt
      ? Math.max(
          0,
          Math.floor((this.now().getTime() - new Date(latestObservedAt).getTime()) / 1_000),
        )
      : 0;
    const uniqueDays = new Set(statisticalSeries.map((entry) => entry.observedAt.slice(0, 10)))
      .size;
    const kinds = new Set(rows.map((row) => row.observation_kind));
    const state: TrendState =
      rows.length === 0
        ? "no_data"
        : statisticalSeries.length < minimumStatisticalSampleSize
          ? "insufficient_data"
          : "ready";

    return {
      counts: {
        byMarketStatus: countBy(
          rows.map((row) => row.market_status),
          { active: 0, sold: 0, unknown: 0 },
        ),
        byMarketplace: countBy(
          rows.map((row) => row.source_marketplace),
          {} as Record<string, number>,
        ),
        byObservationKind: countBy(
          rows.map((row) => row.observation_kind),
          {
            asking: 0,
            completed_auction: 0,
            confirmed_sold: 0,
            current_bid: 0,
          },
        ),
      },
      currency: latestCurrency,
      filters: {
        from: filters.from?.toISOString(),
        providers: normalizedProviders,
        to: filters.to?.toISOString(),
      },
      listingId: `${listing.provider_id}:${listing.source_listing_id}`,
      series,
      state,
      summary: {
        changes: changes(statisticalSeries, latest),
        confidence: confidence(statisticalSeries.length, uniqueDays, ageSeconds, kinds),
        excludedCurrencyCount: series.length - statisticalSeries.length,
        freshness: latestObservedAt
          ? {
              ageSeconds,
              isStale: ageSeconds > 604_800,
              latestObservedAt: toIso(latestObservedAt),
              status:
                ageSeconds <= 86_400
                  ? ("fresh" as const)
                  : ageSeconds <= 604_800
                    ? ("aging" as const)
                    : ("stale" as const),
            }
          : undefined,
        inlierCount: sortedAmounts.length - outlierCount,
        iqrMinor,
        lowerFenceMinor,
        medianMinor: percentile(sortedAmounts, 0.5),
        outlierCount,
        q1Minor,
        q3Minor,
        sampleSize: statisticalSeries.length,
        upperFenceMinor,
        uniqueDayCount: uniqueDays,
      },
      truncated,
    };
  }
}
