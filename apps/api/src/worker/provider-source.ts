import { createHash } from "node:crypto";
import type {
  Provider,
  ProviderFailure,
  ProviderSearchQuery,
} from "@closetsearch/providers";
import type {
  ConvertedMoney,
  Listing,
  ListingAvailabilityStatus,
  Money,
} from "@closetsearch/shared";
import type {
  ExactMoneyInput,
  ListingAvailability,
  ListingObservationInput,
  MarketStatus,
} from "../db/postgres/model.js";
import type {
  ProviderIngestionPage,
  ProviderIngestionRequest,
  ProviderIngestionSource,
} from "./ingestion.js";
import { WorkerJobError } from "./types.js";

export interface ProviderIngestionQuery {
  key: string;
  pageSize: number;
  query: ProviderSearchQuery;
}

interface ProviderContinuation {
  cursor?: string;
  page?: number;
}

const zeroFractionCurrencies = new Set(["CLP", "JPY", "KRW", "VND"]);
const threeFractionCurrencies = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "OMR",
  "TND",
]);

function fractionDigits(currency: string) {
  const normalizedCurrency = currency.trim().toUpperCase();

  if (zeroFractionCurrencies.has(normalizedCurrency)) {
    return 0;
  }

  if (threeFractionCurrencies.has(normalizedCurrency)) {
    return 3;
  }

  return 2;
}

function exactMoney(money: Money | undefined): ExactMoneyInput | undefined {
  if (!money) {
    return undefined;
  }

  const currency = money.currency.trim().toUpperCase();
  const digits = money.fractionDigits ?? fractionDigits(currency);
  const amountMinor =
    money.amountMinor ??
    Math.round(money.amount * 10 ** digits);

  if (
    !/^[A-Z]{3}$/.test(currency) ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0
  ) {
    return undefined;
  }

  return {
    amountMinor: BigInt(amountMinor),
    currency,
  };
}

function comparisonMoney(money: ConvertedMoney | undefined) {
  const exact = exactMoney(money);

  if (!exact || !money) {
    return undefined;
  }

  const exchangeRateObservedAt = new Date(money.exchangeRateTimestamp);

  if (Number.isNaN(exchangeRateObservedAt.valueOf())) {
    return undefined;
  }

  return {
    ...exact,
    exchangeRateObservedAt,
    exchangeRateSource: money.exchangeRateSource,
  };
}

function optionalDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function requiredDate(value: string, label: string) {
  const date = optionalDate(value);

  if (!date) {
    throw new WorkerJobError(
      `Provider listing has an invalid ${label} timestamp.`,
      "normalization_failed",
      true,
    );
  }

  return date;
}

function marketStatus(
  listing: Listing,
  scope: ProviderIngestionRequest["ingestionScope"],
): MarketStatus {
  if (
    scope === "sold" ||
    listing.market?.status === "sold" ||
    listing.lifecycle?.status === "sold"
  ) {
    return "sold";
  }

  if (
    listing.market?.status === "active" ||
    listing.lifecycle?.status === "active" ||
    scope === "active" ||
    scope === "refresh" ||
    scope === "watchlist"
  ) {
    return "active";
  }

  return "unknown";
}

function availability(
  status: ListingAvailabilityStatus | undefined,
  normalizedMarketStatus: MarketStatus,
): ListingAvailability {
  switch (status) {
    case "active":
      return "available";
    case "sold":
    case "stale":
    case "removed":
    case "unavailable":
      return status;
    case "unknown":
    case undefined:
      return normalizedMarketStatus === "sold" ? "sold" : "available";
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableSerialize(entry)}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function deterministicUuid(namespace: string) {
  const bytes = createHash("sha256").update(namespace).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString("hex");

  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

function canonicalFingerprint(listing: Listing) {
  const normalizedTitle = listing.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const normalizedBrand = listing.brand.slug.trim().toLowerCase();

  if (
    normalizedTitle.length < 8 ||
    !normalizedBrand ||
    normalizedBrand === "unknown-brand"
  ) {
    return undefined;
  }

  const fingerprint = stableSerialize({
    brand: normalizedBrand,
    category: listing.category?.trim().toLowerCase(),
    condition: listing.condition,
    image: listing.imageUrl,
    size: listing.size?.trim().toLowerCase(),
    title: normalizedTitle,
  });

  return createHash("sha256").update(fingerprint).digest("hex");
}

function idempotencyKey(
  listing: Listing,
  normalizedMarketStatus: MarketStatus,
) {
  const observationIdentity = stableSerialize({
    analyticsEligibility: listing.analyticsEligibility,
    brand: listing.brand,
    category: listing.category,
    condition: listing.condition,
    images: listing.images?.map((image) => image.url) ?? [listing.imageUrl],
    lifecycle: {
      endedAt: listing.lifecycle?.endedAt,
      soldAt: listing.lifecycle?.soldAt,
      sourceUpdatedAt: listing.lifecycle?.sourceUpdatedAt,
      status: listing.lifecycle?.status,
    },
    listingType: listing.listingType,
    marketStatus: normalizedMarketStatus,
    pricing: listing.pricing ?? { original: listing.price },
    providerId: listing.providerId,
    providerListingId: listing.providerListingId,
    seller: listing.seller,
    shipping: listing.shipping,
    size: listing.size,
    sourceUrl: listing.sourceUrl,
    title: listing.title,
  });

  return createHash("sha256").update(observationIdentity).digest("hex");
}

function sellerMetadata(listing: Listing) {
  return listing.seller
    ? JSON.parse(JSON.stringify(listing.seller)) as Record<string, unknown>
    : undefined;
}

function shippingMetadata(listing: Listing) {
  return listing.shipping
    ? JSON.parse(JSON.stringify(listing.shipping)) as Record<string, unknown>
    : undefined;
}

export function toListingObservation(
  listing: Listing,
  scope: ProviderIngestionRequest["ingestionScope"],
): ListingObservationInput {
  const originalPrice = exactMoney(
    listing.pricing?.original ?? listing.price,
  );

  if (!originalPrice) {
    throw new WorkerJobError(
      "Provider listing has invalid original money.",
      "normalization_failed",
      true,
    );
  }

  const normalizedMarketStatus = marketStatus(listing, scope);
  const fetchedAt = requiredDate(listing.fetchedAt, "fetchedAt");
  const observedAt =
    optionalDate(listing.lifecycle?.observedAt) ?? fetchedAt;
  const images = (listing.images ?? [
    {
      url: listing.imageUrl,
    },
  ]).map((image) => ({
    height: image.height,
    url: image.url,
    width: image.width,
  }));

  return {
    analyticsEligible:
      listing.source.dataOrigin !== "mock" &&
      listing.source.isMock !== true &&
      listing.analyticsEligibility?.eligible !== false &&
      listing.market?.isExcludedFromAnalytics !== true,
    availability: availability(
      listing.lifecycle?.status,
      normalizedMarketStatus,
    ),
    canonicalFingerprint: canonicalFingerprint(listing),
    category: listing.category,
    comparisonPrice: comparisonMoney(listing.pricing?.comparison),
    condition: listing.condition,
    fetchedAt,
    id: deterministicUuid(
      `listing:${listing.providerId}:${listing.providerListingId}`,
    ),
    idempotencyKey: idempotencyKey(listing, normalizedMarketStatus),
    images,
    landedPrice: exactMoney(listing.pricing?.landed),
    listedAt: optionalDate(listing.lifecycle?.listedAt),
    listingType: listing.listingType,
    marketStatus: normalizedMarketStatus,
    observedAt,
    originalPrice,
    providerBrand: listing.brand.name,
    providerId: listing.providerId,
    providerUpdatedAt: optionalDate(
      listing.lifecycle?.sourceUpdatedAt ??
        listing.freshness?.sourceUpdatedAt,
    ),
    sellerMetadata: sellerMetadata(listing),
    shippingMetadata: shippingMetadata(listing),
    shippingPrice: exactMoney(
      listing.pricing?.shipping ?? listing.shipping?.cost,
    ),
    size: listing.size,
    soldAt: optionalDate(listing.lifecycle?.soldAt),
    soldPrice: exactMoney(listing.market?.soldPrice),
    sourceListingId: listing.providerListingId,
    sourceMarketplace: listing.source.name,
    sourceUrl: listing.sourceUrl,
    staleAfter: optionalDate(listing.freshness?.staleAt),
    title: listing.title,
  };
}

function parseContinuation(value: unknown): ProviderContinuation {
  if (value === undefined || value === null) {
    return { page: 1 };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkerJobError(
      "Provider continuation checkpoint is invalid.",
      "invalid_ingestion_checkpoint",
      true,
    );
  }

  const cursor =
    typeof (value as { cursor?: unknown }).cursor === "string"
      ? (value as { cursor: string }).cursor.trim()
      : undefined;
  const pageValue = (value as { page?: unknown }).page;
  const page =
    typeof pageValue === "number" &&
    Number.isSafeInteger(pageValue) &&
    pageValue >= 1
      ? pageValue
      : undefined;

  if (
    (cursor !== undefined && (cursor.length === 0 || cursor.length > 8_192)) ||
    (cursor === undefined && page === undefined)
  ) {
    throw new WorkerJobError(
      "Provider continuation checkpoint is invalid.",
      "invalid_ingestion_checkpoint",
      true,
    );
  }

  return { cursor, page };
}

function nextContinuation(
  current: ProviderContinuation,
  pagination: {
    hasMore?: boolean;
    nextCursor?: string;
    nextPage?: number;
    page?: number;
  } | undefined,
) {
  if (!pagination?.hasMore) {
    return undefined;
  }

  if (pagination.nextCursor) {
    return { cursor: pagination.nextCursor };
  }

  if (
    typeof pagination.nextPage === "number" &&
    Number.isSafeInteger(pagination.nextPage) &&
    pagination.nextPage >= 1
  ) {
    return { page: pagination.nextPage };
  }

  return {
    page: (pagination.page ?? current.page ?? 1) + 1,
  };
}

function providerFailure(error: ProviderFailure): WorkerJobError {
  return new WorkerJobError(
    error.message,
    `provider_${error.code}`,
    error.classification === "terminal" || error.retryable === false,
    error.retryAfterMs,
  );
}

export class ContractProviderIngestionSource
  implements ProviderIngestionSource
{
  readonly providerId: string;
  private readonly queries: ReadonlyMap<string, ProviderIngestionQuery>;

  constructor(
    private readonly provider: Provider,
    queries: readonly ProviderIngestionQuery[],
  ) {
    this.providerId = provider.id;
    this.queries = new Map(queries.map((query) => [query.key, query]));
  }

  async fetchPage(
    request: ProviderIngestionRequest,
  ): Promise<ProviderIngestionPage> {
    if (request.signal.aborted) {
      throw request.signal.reason ?? new Error("Provider ingestion aborted.");
    }

    const definition = this.queries.get(request.queryKey);

    if (!definition) {
      throw new WorkerJobError(
        `Provider ingestion query ${request.queryKey} is not configured.`,
        "ingestion_query_not_configured",
        true,
      );
    }

    const expectedScope =
      definition.query.marketScope === "sold" ? "sold" : "active";

    if (
      (request.ingestionScope === "sold") !==
      (expectedScope === "sold")
    ) {
      throw new WorkerJobError(
        "Provider ingestion scope does not match its configured query.",
        "ingestion_query_scope_mismatch",
        true,
      );
    }

    const continuation = parseContinuation(request.continuationCursor);
    const startedAt = performance.now();
    const response = await this.provider.search({
      pagination: {
        cursor: continuation.cursor,
        page: continuation.page,
        pageSize: definition.pageSize,
      },
      query: definition.query,
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

    if (response.status === "failure") {
      throw providerFailure(response.failure);
    }

    if (request.signal.aborted) {
      throw request.signal.reason ?? new Error("Provider ingestion aborted.");
    }

    return {
      continuationCursor: nextContinuation(
        continuation,
        response.pagination,
      ),
      health: {
        latencyMs: response.metadata?.latencyMs ?? latencyMs,
        metadata: {
          dataOrigin:
            response.metadata?.dataOrigin ??
            this.provider.dataOrigin ??
            this.provider.capabilities?.dataOrigin,
          fetchedAt: response.metadata?.fetchedAt,
          resultCount: response.listings.length,
          warnings: response.warnings?.map((warning) => warning.code),
        },
        state:
          response.metadata?.freshness === "stale" ||
          Boolean(response.warnings?.length)
            ? "degraded"
            : "healthy",
      },
      listings: response.listings.map((listing) =>
        toListingObservation(listing, request.ingestionScope),
      ),
    };
  }
}
