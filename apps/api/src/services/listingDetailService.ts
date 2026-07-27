import type {
  Brand,
  Listing,
  ListingCondition,
  ListingMarketplaceLimitations,
  ListingSeller,
  ListingShipping,
  Money,
} from "@closetsearch/shared";
import type { QueryResultRow } from "pg";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import type { PriceObservationKind } from "../db/postgres/model.js";
import { formatPublicListingId, parsePublicListingId } from "../db/postgres/public-listing-id.js";

interface ListingDetailRow extends QueryResultRow {
  analytics_eligible: boolean;
  availability: string;
  canonical_brand_id: string | null;
  canonical_brand_name: string | null;
  canonical_brand_slug: string | null;
  category: string | null;
  color: string | null;
  condition: string | null;
  comparison_currency: string | null;
  comparison_price_minor: string | number | bigint | null;
  description: string | null;
  fetched_at: Date | string;
  exchange_rate_observed_at: Date | string | null;
  exchange_rate_source: string | null;
  id: string;
  last_seen_at: Date | string;
  listed_at: Date | string | null;
  listing_type: string;
  market_status: string;
  marketplace_limitations: unknown;
  material: string | null;
  original_currency: string;
  original_description: string | null;
  original_language: string | null;
  original_price_minor: string | number | bigint;
  original_title: string | null;
  provider_brand: string | null;
  provider_id: string;
  provider_updated_at: Date | string | null;
  seller_metadata: unknown;
  shipping_metadata: unknown;
  size: string | null;
  sold_at: Date | string | null;
  source_listing_id: string;
  source_marketplace: string;
  source_url: string;
  stale_after: Date | string | null;
  title: string;
  translated_description: string | null;
  translated_title: string | null;
}

interface LatestPriceRow extends QueryResultRow {
  auction_ends_at: Date | string | null;
  bid_count: number | null;
  buy_now_currency: string | null;
  buy_now_price_minor: string | number | bigint | null;
  completed_auction_currency: string | null;
  completed_auction_price_minor: string | number | bigint | null;
  current_bid_currency: string | null;
  current_bid_minor: string | number | bigint | null;
  landed_currency: string | null;
  landed_price_minor: string | number | bigint | null;
  market_status: string;
  observation_kind: PriceObservationKind;
  observed_at: Date | string;
  original_currency: string;
  original_price_minor: string | number | bigint;
  shipping_currency: string | null;
  shipping_price_minor: string | number | bigint | null;
  sold_currency: string | null;
  sold_price_minor: string | number | bigint | null;
}

interface ImageRow extends QueryResultRow {
  height: number | null;
  image_url: string;
  ordinal: number;
  width: number | null;
}

const zeroFractionCurrencies = new Set(["CLP", "JPY", "KRW", "VND"]);
const threeFractionCurrencies = new Set(["BHD", "IQD", "JOD", "KWD", "OMR", "TND"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fractionDigits(currency: string) {
  const normalized = currency.trim().toUpperCase();

  if (zeroFractionCurrencies.has(normalized)) {
    return 0;
  }

  return threeFractionCurrencies.has(normalized) ? 3 : 2;
}

function exactMinor(value: string | number | bigint) {
  const parsed = typeof value === "bigint" ? value : BigInt(value);

  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Persisted listing money is outside the supported exact-integer range.");
  }

  return Number(parsed);
}

function money(
  amountMinor: string | number | bigint | null,
  currency: string | null,
): Money | undefined {
  if (amountMinor === null || currency === null) {
    return undefined;
  }

  const normalizedCurrency = currency.trim().toUpperCase();
  const digits = fractionDigits(normalizedCurrency);
  const normalizedMinor = exactMinor(amountMinor);

  return {
    amount: normalizedMinor / 10 ** digits,
    amountMinor: normalizedMinor,
    currency: normalizedCurrency,
    fractionDigits: digits,
  };
}

function toIso(value: Date | string) {
  return new Date(value).toISOString();
}

function condition(value: string | null): ListingCondition | undefined {
  return value === "new_with_tags" ||
    value === "new_without_tags" ||
    value === "excellent" ||
    value === "good" ||
    value === "fair" ||
    value === "unknown"
    ? value
    : undefined;
}

function fallbackSlug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 160) || "unknown-brand"
  );
}

function brand(row: ListingDetailRow): Brand {
  const name = row.canonical_brand_name ?? row.provider_brand ?? "Unknown brand";
  const slug = row.canonical_brand_slug ?? fallbackSlug(name);

  return {
    id: row.canonical_brand_id ?? `provider:${row.provider_id}:${slug}`,
    name,
    slug,
  };
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function marketplaceLimitations(value: unknown): ListingMarketplaceLimitations | undefined {
  const candidate = jsonObject(value);
  const internationalShipping = candidate?.internationalShipping;
  const notices = Array.isArray(candidate?.notices)
    ? candidate.notices
        .filter(
          (notice): notice is string => typeof notice === "string" && notice.trim().length > 0,
        )
        .slice(0, 20)
    : undefined;

  if (
    candidate?.closetSearchRole !== "discovery_only" ||
    (internationalShipping !== "available" &&
      internationalShipping !== "domestic_only" &&
      internationalShipping !== "proxy_only" &&
      internationalShipping !== "unknown")
  ) {
    return undefined;
  }

  return {
    closetSearchRole: "discovery_only",
    internationalShipping,
    notices: notices?.length ? notices : undefined,
    proxyPurchaseRequired:
      typeof candidate.proxyPurchaseRequired === "boolean"
        ? candidate.proxyPurchaseRequired
        : undefined,
  };
}

function optionalString(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, maximum)
    : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalIso(value: unknown) {
  const raw = optionalString(value, 100);

  if (!raw) {
    return undefined;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function safeHttpsUrl(value: unknown) {
  const raw = optionalString(value, 2_048);

  if (!raw) {
    return undefined;
  }

  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function sellerMetadata(value: unknown): ListingSeller | undefined {
  const candidate = jsonObject(value);

  if (!candidate) {
    return undefined;
  }

  const location = jsonObject(candidate.location);
  const trustTier =
    candidate.trustTier === "trusted" ||
    candidate.trustTier === "established" ||
    candidate.trustTier === "unverified" ||
    candidate.trustTier === "unknown"
      ? candidate.trustTier
      : undefined;
  const seller: ListingSeller = {
    displayName: optionalString(candidate.displayName, 200),
    feedbackCount: optionalNumber(candidate.feedbackCount),
    feedbackPercentage: optionalNumber(candidate.feedbackPercentage),
    feedbackScore: optionalNumber(candidate.feedbackScore),
    id: optionalString(candidate.id, 256),
    location: location
      ? {
          city: optionalString(location.city, 160),
          country: optionalString(location.country, 80),
          region: optionalString(location.region, 160),
        }
      : undefined,
    profileUrl: safeHttpsUrl(candidate.profileUrl),
    trustTier,
    username: optionalString(candidate.username, 200),
  };

  return Object.values(seller).some((entry) => entry !== undefined) ? seller : undefined;
}

function metadataMoney(value: unknown) {
  const candidate = jsonObject(value);
  const amountMinor = optionalNumber(candidate?.amountMinor);
  const currency = optionalString(candidate?.currency, 3)?.toUpperCase();

  if (
    amountMinor === undefined ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    !currency ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return undefined;
  }

  return money(BigInt(amountMinor), currency);
}

function shippingMetadata(
  value: unknown,
  latestCost: Money | undefined,
): ListingShipping | undefined {
  const candidate = jsonObject(value);

  if (!candidate && !latestCost) {
    return undefined;
  }

  const payer =
    candidate?.payer === "buyer" ||
    candidate?.payer === "seller" ||
    candidate?.payer === "shared" ||
    candidate?.payer === "unknown"
      ? candidate.payer
      : undefined;

  return {
    available: typeof candidate?.available === "boolean" ? candidate.available : undefined,
    cost: latestCost ?? metadataMoney(candidate?.cost),
    destinationCountry: optionalString(candidate?.destinationCountry, 80),
    isFree: typeof candidate?.isFree === "boolean" ? candidate.isFree : undefined,
    maxEstimatedDeliveryAt: optionalIso(candidate?.maxEstimatedDeliveryAt),
    minEstimatedDeliveryAt: optionalIso(candidate?.minEstimatedDeliveryAt),
    originCountry: optionalString(candidate?.originCountry, 80),
    payer,
    type: optionalString(candidate?.type, 160),
  };
}

async function resolveListing(
  dataPlane: PostgresDataPlane,
  listingId: string,
): Promise<ListingDetailRow | undefined> {
  const publicIdentity = parsePublicListingId(listingId);
  const identityPredicate = publicIdentity
    ? "listing.provider_id = $1 AND listing.source_listing_id = $2"
    : uuidPattern.test(listingId)
      ? "listing.id = $1"
      : undefined;
  const parameters = publicIdentity
    ? [publicIdentity.providerId, publicIdentity.sourceListingId]
    : [listingId];

  if (!identityPredicate) {
    return undefined;
  }

  const result = await dataPlane.database.query<ListingDetailRow>(
    `SELECT
       listing.id,
       listing.provider_id,
       listing.source_marketplace,
       listing.source_listing_id,
       listing.title,
       listing.description,
       listing.original_title,
       listing.original_description,
       listing.original_language,
       listing.translated_title,
       listing.translated_description,
       listing.marketplace_limitations,
       listing.canonical_brand_id,
       listing.provider_brand,
       listing.category,
       listing.size,
       listing.condition,
       listing.material,
       listing.color,
       listing.listing_type,
       listing.source_url,
       listing.seller_metadata,
       listing.shipping_metadata,
       listing.original_price_minor,
       listing.original_currency,
       listing.comparison_price_minor,
       listing.comparison_currency,
       listing.exchange_rate_source,
       listing.exchange_rate_observed_at,
       listing.listed_at,
       listing.provider_updated_at,
       listing.fetched_at,
       listing.analytics_eligible,
       brand.slug AS canonical_brand_slug,
       brand.canonical_name AS canonical_brand_name,
       state.market_status,
       state.availability,
       state.last_seen_at,
       state.stale_after,
       state.sold_at
     FROM listings listing
     JOIN listing_current_state state ON state.listing_id = listing.id
     LEFT JOIN brands brand ON brand.id = listing.canonical_brand_id
     WHERE ${identityPredicate}`,
    parameters,
  );

  return result.rows[0];
}

export class ListingDetailService {
  constructor(
    private readonly dataPlane: PostgresDataPlane,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getListing(listingId: string): Promise<Listing | undefined> {
    const row = await resolveListing(this.dataPlane, listingId);

    if (!row) {
      return undefined;
    }

    const [latestResult, imagesResult] = await Promise.all([
      this.dataPlane.database.query<LatestPriceRow>(
        `SELECT
           observation_kind,
           market_status,
           observed_at,
           original_price_minor,
           original_currency,
           sold_price_minor,
           sold_currency,
           shipping_price_minor,
           shipping_currency,
           landed_price_minor,
           landed_currency,
           current_bid_minor,
           current_bid_currency,
           completed_auction_price_minor,
           completed_auction_currency,
           buy_now_price_minor,
           buy_now_currency,
           bid_count,
           auction_ends_at
         FROM price_observations
         WHERE listing_id = $1
         ORDER BY observation_version DESC
         LIMIT 1`,
        [row.id],
      ),
      this.dataPlane.database.query<ImageRow>(
        `SELECT ordinal, image_url, width, height
         FROM listing_images
         WHERE listing_id = $1
         ORDER BY ordinal`,
        [row.id],
      ),
    ]);
    const latest = latestResult.rows[0];
    const originalPrice =
      money(
        latest?.original_price_minor ?? row.original_price_minor,
        latest?.original_currency ?? row.original_currency,
      ) ??
      (() => {
        throw new Error("Persisted listing is missing its original price.");
      })();
    const shippingPrice = latest
      ? money(latest.shipping_price_minor, latest.shipping_currency)
      : undefined;
    const landedPrice = latest
      ? money(latest.landed_price_minor, latest.landed_currency)
      : undefined;
    const currentBid =
      latest?.observation_kind === "current_bid"
        ? money(latest.current_bid_minor, latest.current_bid_currency)
        : undefined;
    const completedPrice =
      latest?.observation_kind === "completed_auction"
        ? (money(latest.completed_auction_price_minor, latest.completed_auction_currency) ??
          money(latest.sold_price_minor, latest.sold_currency))
        : undefined;
    const confirmedSoldPrice =
      latest?.observation_kind === "confirmed_sold"
        ? money(latest.sold_price_minor, latest.sold_currency)
        : completedPrice;
    const buyNowPrice = latest
      ? money(latest.buy_now_price_minor, latest.buy_now_currency)
      : undefined;
    const observedAt = latest ? toIso(latest.observed_at) : toIso(row.last_seen_at);
    const staleAt = row.stale_after ? toIso(row.stale_after) : undefined;
    const isStale =
      row.availability === "stale" ||
      (staleAt !== undefined && new Date(staleAt).getTime() <= this.now().getTime());
    const images = imagesResult.rows.map((image, index) => ({
      alt: row.title,
      height: image.height ?? undefined,
      role: index === 0 ? ("primary" as const) : ("alternate" as const),
      url: image.image_url,
      width: image.width ?? undefined,
    }));
    const imageUrl = images[0]?.url ?? "/listing-placeholder.svg";
    const publicId = formatPublicListingId(row.provider_id, row.source_listing_id);
    const lifecycleStatus =
      row.availability === "available"
        ? ("active" as const)
        : row.availability === "sold" ||
            row.availability === "stale" ||
            row.availability === "removed" ||
            row.availability === "unavailable"
          ? row.availability
          : ("unknown" as const);
    const listingType =
      row.listing_type === "auction" || row.listing_type === "buy_now"
        ? row.listing_type
        : ("unknown" as const);
    const comparisonPrice = money(row.comparison_price_minor, row.comparison_currency);
    const convertedPrice =
      comparisonPrice &&
      row.exchange_rate_source &&
      row.exchange_rate_observed_at &&
      originalPrice.amount > 0
        ? {
            ...comparisonPrice,
            exchangeRate: String(
              Math.round((comparisonPrice.amount / originalPrice.amount) * 1_000_000_000_000) /
                1_000_000_000_000,
            ),
            exchangeRateSource: row.exchange_rate_source,
            exchangeRateTimestamp: toIso(row.exchange_rate_observed_at),
            sourceAmountMinor: originalPrice.amountMinor as number,
            sourceCurrency: originalPrice.currency,
          }
        : undefined;

    return {
      analyticsEligibility: {
        eligible: row.analytics_eligible,
        exclusionReasons: row.analytics_eligible
          ? undefined
          : ["provider_or_listing_not_analytics_eligible"],
      },
      attribution: {
        destinationUrl: row.source_url,
        displayText: `Continue to ${row.source_marketplace}`,
        marketplaceName: row.source_marketplace,
        required: true,
      },
      auction:
        listingType === "auction"
          ? {
              bidCount: latest?.bid_count ?? undefined,
              buyNowPrice,
              completedPrice,
              currentBid,
              endsAt: latest?.auction_ends_at ? toIso(latest.auction_ends_at) : undefined,
            }
          : undefined,
      brand: brand(row),
      category: row.category ?? undefined,
      color: row.color ?? undefined,
      condition: condition(row.condition),
      description: row.description ?? undefined,
      fetchedAt: toIso(row.fetched_at),
      freshness: {
        observedAt,
        sourceUpdatedAt: row.provider_updated_at ? toIso(row.provider_updated_at) : undefined,
        staleAt,
        status: isStale ? "stale" : "fresh",
      },
      id: publicId,
      imageUrl,
      images,
      lifecycle: {
        lastSeenAt: toIso(row.last_seen_at),
        listedAt: row.listed_at ? toIso(row.listed_at) : undefined,
        observedAt,
        soldAt: row.sold_at ? toIso(row.sold_at) : undefined,
        sourceUpdatedAt: row.provider_updated_at ? toIso(row.provider_updated_at) : undefined,
        status: lifecycleStatus,
      },
      listingType,
      market:
        row.market_status === "active" || row.market_status === "sold"
          ? {
              askingPrice: originalPrice,
              isExcludedFromAnalytics: !row.analytics_eligible,
              soldPrice: confirmedSoldPrice,
              status: row.market_status,
            }
          : undefined,
      marketplaceLimitations: marketplaceLimitations(row.marketplace_limitations),
      material: row.material ?? undefined,
      originalDescription: row.original_description ?? undefined,
      originalLanguage: row.original_language ?? undefined,
      originalTitle: row.original_title ?? undefined,
      price: currentBid ?? confirmedSoldPrice ?? originalPrice,
      pricing: {
        comparison: convertedPrice,
        display: convertedPrice,
        landed: landedPrice,
        original: originalPrice,
        shipping: shippingPrice,
      },
      providerId: row.provider_id,
      providerListingId: row.source_listing_id,
      seller: sellerMetadata(row.seller_metadata),
      shipping: shippingMetadata(row.shipping_metadata, shippingPrice),
      size: row.size ?? undefined,
      source: {
        id: row.provider_id,
        isMock: row.provider_id === "mock" || undefined,
        marketplaceId: row.provider_id,
        name: row.source_marketplace,
      },
      sourceUrl: row.source_url,
      title: row.title,
      translatedDescription: row.translated_description ?? undefined,
      translatedTitle: row.translated_title ?? undefined,
    };
  }
}
