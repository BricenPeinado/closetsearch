import { useEffect, useMemo, useState } from "react";
import { ApiClientError, fetchJson } from "../api-client";
import {
  currencyFractionDigits,
  formatDateTime,
  formatMinorMoney,
  getPreferredLocale,
  getPreferredTimeZone,
} from "../product-formatting";

type TrendWindow = "30d" | "90d" | "365d" | "all";

interface PriceTrendPoint {
  amountMinor: number;
  auctionEndsAt?: string;
  bidCount?: number;
  currency: string;
  landedPriceMinor?: number;
  marketplace: string;
  marketStatus: string;
  observationKind: string;
  observedAt: string;
  providerId: string;
}

interface PriceTrendResponse {
  listingId: string;
  filters?: {
    from?: string;
    providers?: string[];
    to?: string;
  };
  currency: string;
  state: "ready" | "insufficient_data" | "no_data";
  summary?: {
    changes?: {
      days7?: PriceTrendChange | null;
      days30?: PriceTrendChange | null;
      days90?: PriceTrendChange | null;
      days365?: PriceTrendChange | null;
    };
    confidence?: {
      level?: string;
      reasons?: string[];
      score?: number;
    };
    freshness?: {
      ageSeconds?: number;
      isStale?: boolean;
      latestObservedAt?: string;
    };
    iqrMinor?: number;
    medianMinor?: number;
    q1Minor?: number;
    q3Minor?: number;
    sampleSize?: number;
  };
  counts?: {
    byMarketplace?: Record<string, number>;
    byMarketStatus?: Record<string, number>;
    byObservationKind?: Record<string, number>;
  };
  series: PriceTrendPoint[];
}

interface PriceTrendChange {
  absoluteMinor: number;
  baselineAmountMinor: number;
  baselineObservedAt: string;
  percent: number;
}

interface ChartPoint extends PriceTrendPoint {
  timestamp: number;
  x: number;
  y: number;
}

const chartWidth = 720;
const chartHeight = 280;
const chartMargin = { bottom: 34, left: 66, right: 24, top: 26 };

const trendKinds = [
  {
    aliases: ["asking", "active_asking", "asking_price"],
    color: "#32665a",
    label: "Asking",
  },
  {
    aliases: ["confirmed_sold", "sold", "sold_price"],
    color: "#9a4f31",
    label: "Confirmed sold",
  },
  {
    aliases: ["auction_bid", "current_bid"],
    color: "#4867a8",
    label: "Auction bid",
  },
  {
    aliases: ["auction_completed", "completed_auction"],
    color: "#7b4f94",
    label: "Completed auction",
  },
] as const;

function canonicalKind(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    trendKinds.find((kind) => kind.aliases.some((alias) => alias === normalized))?.label ??
    "Other observation"
  );
}

function kindColor(label: string) {
  return trendKinds.find((kind) => kind.label === label)?.color ?? "#6b625b";
}

function windowStart(window: TrendWindow) {
  if (window === "all") {
    return undefined;
  }

  const days = window === "30d" ? 30 : window === "90d" ? 90 : 365;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function boundedNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeTrendResponse(value: PriceTrendResponse): PriceTrendResponse {
  const series = Array.isArray(value.series)
    ? value.series.filter(
        (point) =>
          point &&
          typeof point.observedAt === "string" &&
          typeof point.currency === "string" &&
          typeof point.amountMinor === "number" &&
          Number.isSafeInteger(point.amountMinor),
      )
    : [];

  return {
    ...value,
    currency: value.currency || series[0]?.currency || "USD",
    series,
    state:
      value.state === "ready" || value.state === "insufficient_data" || value.state === "no_data"
        ? value.state
        : series.length > 1
          ? "ready"
          : series.length === 1
            ? "insufficient_data"
            : "no_data",
  };
}

function PriceTrendChart({
  currency,
  locale,
  response,
  timeZone,
}: {
  currency: string;
  locale: string;
  response: PriceTrendResponse;
  timeZone: string;
}) {
  const points = response.series
    .map((point) => ({
      ...point,
      timestamp: new Date(point.observedAt).getTime(),
    }))
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);

  if (points.length === 0) {
    return null;
  }

  const summaryValues = [
    boundedNumber(response.summary?.q1Minor),
    boundedNumber(response.summary?.medianMinor),
    boundedNumber(response.summary?.q3Minor),
  ].filter((value): value is number => value !== undefined);
  const allValues = [...points.map((point) => point.amountMinor), ...summaryValues];
  const minimumAmount = Math.min(...allValues);
  const maximumAmount = Math.max(...allValues);
  const amountPadding = Math.max(1, (maximumAmount - minimumAmount) * 0.12);
  const domainMinimum = Math.max(0, minimumAmount - amountPadding);
  const domainMaximum = maximumAmount + amountPadding;
  const minimumTime = points[0]?.timestamp ?? 0;
  const maximumTime = points.at(-1)?.timestamp ?? minimumTime;
  const plotWidth = chartWidth - chartMargin.left - chartMargin.right;
  const plotHeight = chartHeight - chartMargin.top - chartMargin.bottom;

  const xScale = (timestamp: number, index: number) =>
    maximumTime === minimumTime
      ? chartMargin.left + (plotWidth * (index + 1)) / (points.length + 1)
      : chartMargin.left +
        ((timestamp - minimumTime) / Math.max(1, maximumTime - minimumTime)) * plotWidth;
  const yScale = (amountMinor: number) =>
    chartMargin.top +
    (1 - (amountMinor - domainMinimum) / Math.max(1, domainMaximum - domainMinimum)) * plotHeight;
  const chartPoints: ChartPoint[] = points.map((point, index) => ({
    ...point,
    x: xScale(point.timestamp, index),
    y: yScale(point.amountMinor),
  }));
  const groups = Array.from(
    chartPoints.reduce((map, point) => {
      const kind = canonicalKind(point.observationKind);
      map.set(kind, [...(map.get(kind) ?? []), point]);
      return map;
    }, new Map<string, ChartPoint[]>()),
  );
  const q1 = boundedNumber(response.summary?.q1Minor);
  const q3 = boundedNumber(response.summary?.q3Minor);
  const median = boundedNumber(response.summary?.medianMinor);
  const fractionDigits = currencyFractionDigits(currency, locale);
  const yTicks = [domainMaximum, (domainMaximum + domainMinimum) / 2, domainMinimum];

  return (
    <div className="price-trend-chart">
      <svg
        aria-labelledby="price-trend-chart-title price-trend-chart-description"
        className="price-trend-chart__svg"
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        <title id="price-trend-chart-title">Listing price history</title>
        <desc id="price-trend-chart-description">
          Asking prices, confirmed sold prices, and auction bids are drawn separately. The shaded
          band shows the observed lower-to-upper quartile range when available.
        </desc>

        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <g key={tick}>
              <line
                className="price-trend-chart__grid-line"
                x1={chartMargin.left}
                x2={chartWidth - chartMargin.right}
                y1={y}
                y2={y}
              />
              <text className="price-trend-chart__axis-label" x={chartMargin.left - 8} y={y + 4}>
                {formatMinorMoney(Math.round(tick), currency, locale, fractionDigits)}
              </text>
            </g>
          );
        })}

        {q1 !== undefined && q3 !== undefined ? (
          <rect
            className="price-trend-chart__quartile-band"
            height={Math.max(2, yScale(q1) - yScale(q3))}
            width={plotWidth}
            x={chartMargin.left}
            y={yScale(q3)}
          />
        ) : null}

        {median !== undefined ? (
          <line
            className="price-trend-chart__median-line"
            x1={chartMargin.left}
            x2={chartWidth - chartMargin.right}
            y1={yScale(median)}
            y2={yScale(median)}
          />
        ) : null}

        {groups.map(([kind, kindPoints]) => {
          const path = kindPoints
            .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
            .join(" ");
          return (
            <g key={kind}>
              {kindPoints.length > 1 ? (
                <path
                  className="price-trend-chart__series-line"
                  d={path}
                  fill="none"
                  stroke={kindColor(kind)}
                />
              ) : null}
              {kindPoints.map((point) => (
                <circle
                  key={`${point.observedAt}:${point.providerId}:${point.amountMinor}`}
                  cx={point.x}
                  cy={point.y}
                  fill={kindColor(kind)}
                  r="4.5"
                >
                  <title>
                    {kind}:{" "}
                    {formatMinorMoney(point.amountMinor, point.currency, locale, fractionDigits)} on{" "}
                    {formatDateTime(point.observedAt, { locale, timeZone })}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}

        <text className="price-trend-chart__date-label" x={chartMargin.left} y={chartHeight - 8}>
          {formatDateTime(points[0]?.observedAt ?? "", {
            includeZone: false,
            locale,
            timeZone,
          })}
        </text>
        <text
          className="price-trend-chart__date-label price-trend-chart__date-label--end"
          x={chartWidth - chartMargin.right}
          y={chartHeight - 8}
        >
          {formatDateTime(points.at(-1)?.observedAt ?? "", {
            includeZone: false,
            locale,
            timeZone,
          })}
        </text>
      </svg>

      <div aria-label="Price observation legend" className="price-trend-chart__legend">
        {groups.map(([kind]) => (
          <span className="price-trend-chart__legend-item" key={kind}>
            <span
              aria-hidden="true"
              className="price-trend-chart__legend-swatch"
              style={{ backgroundColor: kindColor(kind) }}
            />
            {kind}
          </span>
        ))}
        {q1 !== undefined && q3 !== undefined ? (
          <span className="price-trend-chart__legend-item">
            <span
              aria-hidden="true"
              className="price-trend-chart__legend-swatch price-trend-chart__legend-swatch--band"
            />
            Quartile range
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function formatTrendChange(value: PriceTrendChange | number | null | undefined) {
  const percent =
    typeof value === "number"
      ? value
      : value && typeof value === "object"
        ? boundedNumber(value.percent)
        : undefined;

  if (percent === undefined) {
    return "Not enough data";
  }

  const prefix = percent > 0 ? "+" : "";
  return `${prefix}${percent.toFixed(1)}%`;
}

export function PriceTrendPanel({
  listingId,
  locale = getPreferredLocale(),
  timeZone = getPreferredTimeZone(),
}: {
  listingId: string;
  locale?: string;
  timeZone?: string;
}) {
  const [provider, setProvider] = useState("");
  const [trendWindow, setTrendWindow] = useState<TrendWindow>("90d");
  const [state, setState] = useState<{
    errorMessage?: string;
    response?: PriceTrendResponse;
    status: "loading" | "success" | "error";
  }>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    const from = windowStart(trendWindow);
    if (from) {
      params.set("from", from);
    }
    if (provider) {
      params.set("provider", provider);
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";

    setState((current) => ({ ...current, errorMessage: undefined, status: "loading" }));
    void fetchJson<PriceTrendResponse>(
      `/listings/${encodeURIComponent(listingId)}/price-trends${query}`,
      controller.signal,
    )
      .then((response) => {
        setState({ response: normalizeTrendResponse(response), status: "success" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const unavailable =
          error instanceof ApiClientError &&
          (error.status === 404 ||
            error.code === "price_intelligence_unavailable" ||
            error.code === "price_trends_unavailable");
        setState({
          errorMessage: unavailable
            ? "Price history is not available for this listing yet."
            : error instanceof Error
              ? error.message
              : "Price history could not be loaded.",
          status: "error",
        });
      });

    return () => controller.abort();
  }, [listingId, provider, trendWindow]);

  const response = state.response;
  const providerOptions = useMemo(() => {
    if (!response) {
      return [];
    }

    return Array.from(
      new Map(
        response.series.map((point) => [point.providerId, point.marketplace || point.providerId]),
      ),
    ).sort((left, right) => left[1].localeCompare(right[1], locale));
  }, [locale, response]);
  const currency = response?.currency || response?.series[0]?.currency || "USD";
  const latestObservation = response?.summary?.freshness?.latestObservedAt;
  const sampleSize = response?.summary?.sampleSize ?? response?.series.length ?? 0;
  const confidence = response?.summary?.confidence?.level ?? "Not rated";

  return (
    <section aria-labelledby="price-history-heading" className="price-trends-panel">
      <div className="section-heading section-heading--split">
        <div>
          <p className="eyebrow">Observed market data</p>
          <h2 id="price-history-heading">Price history</h2>
          <p>
            Asking prices, confirmed sales, and auction bids remain separate. Active asks are never
            presented as realized sale prices.
          </p>
        </div>
        <div className="chip-row">
          <span className="info-chip">{sampleSize} observations</span>
          <span className="info-chip">Confidence: {confidence}</span>
          {response?.summary?.freshness?.isStale ? (
            <span className="info-chip info-chip--warning">Stale data</span>
          ) : null}
        </div>
      </div>

      <div className="price-trend-controls">
        <div aria-label="Price history time window" className="segmented-control" role="group">
          {(["30d", "90d", "365d", "all"] as const).map((value) => (
            <button
              aria-pressed={trendWindow === value}
              className={
                trendWindow === value ? "segment-button segment-button--active" : "segment-button"
              }
              key={value}
              onClick={() => setTrendWindow(value)}
              type="button"
            >
              {value === "all" ? "All" : value.replace("d", " days")}
            </button>
          ))}
        </div>

        <label className="field-group price-trend-provider" htmlFor="price-trend-provider">
          <span>Marketplace</span>
          <select
            id="price-trend-provider"
            onChange={(event) => setProvider(event.target.value)}
            value={provider}
          >
            <option value="">All observed marketplaces</option>
            {providerOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.status === "loading" ? (
        <div aria-live="polite" className="trend-loading" role="status">
          <span className="skeleton-line" />
          <span className="skeleton-line skeleton-line--short" />
          Loading observed price history…
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="state-card state-card--inline" role="status">
          <h3>Price context unavailable</h3>
          <p>{state.errorMessage}</p>
        </div>
      ) : null}

      {state.status === "success" && response && response.state !== "ready" ? (
        <div className="state-card state-card--inline" role="status">
          <h3>
            {response.state === "no_data" ? "No price observations yet" : "Insufficient data"}
          </h3>
          <p>
            {response.state === "no_data"
              ? "ClosetSearch has not recorded reliable price observations for this listing."
              : `Only ${sampleSize} reliable observation${sampleSize === 1 ? "" : "s"} are available. A trend is withheld until the minimum sample is met.`}
          </p>
        </div>
      ) : null}

      {state.status === "success" && response?.state === "ready" ? (
        <>
          <PriceTrendChart
            currency={currency}
            locale={locale}
            response={response}
            timeZone={timeZone}
          />

          <div className="trend-metrics">
            <article>
              <span>Median</span>
              <strong>
                {response.summary?.medianMinor !== undefined
                  ? formatMinorMoney(response.summary.medianMinor, currency, locale)
                  : "Not available"}
              </strong>
            </article>
            <article>
              <span>Middle 50%</span>
              <strong>
                {response.summary?.q1Minor !== undefined && response.summary?.q3Minor !== undefined
                  ? `${formatMinorMoney(response.summary.q1Minor, currency, locale)}–${formatMinorMoney(response.summary.q3Minor, currency, locale)}`
                  : "Not available"}
              </strong>
            </article>
            <article>
              <span>30-day change</span>
              <strong>{formatTrendChange(response.summary?.changes?.days30)}</strong>
            </article>
            <article>
              <span>90-day change</span>
              <strong>{formatTrendChange(response.summary?.changes?.days90)}</strong>
            </article>
          </div>
          <p className="analytics-note">
            {latestObservation
              ? `Latest observation ${formatDateTime(latestObservation, { locale, timeZone })}.`
              : "Latest observation time is unavailable."}{" "}
            Price context is descriptive, not a guarantee, valuation, or authenticity assessment.
          </p>
        </>
      ) : null}
    </section>
  );
}
