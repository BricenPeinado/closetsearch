import type { IncomingMessage } from "node:http";
import { ApiError } from "../api-error.js";
import { resolvePersistenceDriver } from "../db/persistence-driver.js";
import { getPostgresDataPlane } from "../db/persistence-runtime.js";
import { PriceTrendService } from "../services/priceTrendService.js";
import type { RouteResult } from "./route-result.js";

const providerPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function parseDate(value: string | null, name: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "invalid_price_trend_filter", `${name} must be an ISO timestamp.`);
  }

  return date;
}

function parseProviders(requestUrl: URL) {
  const values = [
    ...requestUrl.searchParams.getAll("provider"),
    ...requestUrl.searchParams.getAll("providers"),
  ]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const providers = Array.from(new Set(values));

  if (providers.length > 20 || providers.some((provider) => !providerPattern.test(provider))) {
    throw new ApiError(
      400,
      "invalid_price_trend_filter",
      "provider must contain at most 20 valid provider IDs.",
    );
  }

  return providers;
}

function matchListingId(pathname: string) {
  const match = /^\/listings\/([^/]+)\/(?:price-trends|price-history)$/.exec(pathname);

  if (!match?.[1]) {
    return undefined;
  }

  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    throw new ApiError(400, "invalid_listing_id", "Listing ID is malformed.");
  }
}

export async function handlePriceTrendRoute(
  request: IncomingMessage,
  requestUrl: URL,
): Promise<RouteResult | undefined> {
  const listingId = matchListingId(requestUrl.pathname);

  if ((request.method ?? "GET") !== "GET" || !listingId) {
    return undefined;
  }

  if (resolvePersistenceDriver() !== "postgres") {
    throw new ApiError(
      503,
      "price_intelligence_unavailable",
      "Durable price history requires PostgreSQL.",
    );
  }

  const from = parseDate(requestUrl.searchParams.get("from"), "from");
  const to = parseDate(requestUrl.searchParams.get("to"), "to");

  if (from && to && from > to) {
    throw new ApiError(
      400,
      "invalid_price_trend_filter",
      "from must be earlier than or equal to to.",
    );
  }

  const trend = await new PriceTrendService(await getPostgresDataPlane()).getListingTrend(
    listingId,
    {
      from,
      providerIds: parseProviders(requestUrl),
      to,
    },
  );

  if (!trend) {
    throw new ApiError(404, "listing_not_found", "Listing was not found.");
  }

  return {
    body: trend,
    headers: {
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
    kind: "json",
    statusCode: 200,
  };
}
