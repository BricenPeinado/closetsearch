import type {
  Brand,
  LikedListing,
  Listing,
  ListingCondition,
  ListingDataOrigin,
  ListingImage,
  ListingSeller,
  ListingShipping,
  Money,
} from "@closetsearch/shared";
import type { QueryResultRow } from "pg";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { formatPublicListingId } from "../db/postgres/public-listing-id.js";

interface LikedListingRow extends QueryResultRow {
  analytics_eligible: boolean;
  availability: string;
  canonical_brand_id: string | null;
  canonical_brand_name: string | null;
  canonical_brand_slug: string | null;
  category: string | null;
  condition: string | null;
  fetched_at: Date | string;
  image_height: number | null;
  image_url: string | null;
  image_width: number | null;
  last_seen_at: Date | string;
  like_created_at: Date | string;
  like_id: string;
  listing_type: string;
  market_status: string;
  original_currency: string;
  original_price_minor: string | number | bigint;
  provider_brand: string | null;
  provider_id: string;
  seller_metadata: unknown;
  shipping_metadata: unknown;
  size: string | null;
  source_listing_id: string;
  source_marketplace: string;
  source_url: string;
  stale_after: Date | string | null;
  title: string;
  user_id: string;
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
  if (zeroFractionCurrencies.has(currency)) {
    return 0;
  }

  return threeFractionCurrencies.has(currency) ? 3 : 2;
}

function money(amountMinor: string | number | bigint, currency: string): Money {
  const exactMinor = Number(BigInt(amountMinor));
  const digits = fractionDigits(currency);

  return {
    amount: exactMinor / 10 ** digits,
    amountMinor: exactMinor,
    currency,
    fractionDigits: digits,
  };
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerOrigin(
  providerId: string,
): ListingDataOrigin | undefined {
  switch (providerId) {
    case "ebay":
      return "official_api";
    case "grailed":
      return "authorized_scraping";
    default:
      return undefined;
  }
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

function brand(row: LikedListingRow): Brand {
  const name = row.canonical_brand_name ?? row.provider_brand ?? "Unknown brand";
  const fallbackSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    id:
      row.canonical_brand_id ??
      `provider:${row.provider_id}:${fallbackSlug || "unknown-brand"}`,
    name,
    slug: row.canonical_brand_slug ?? (fallbackSlug || "unknown-brand"),
  };
}

function toIso(value: Date | string) {
  return new Date(value).toISOString();
}

function listingFromRow(row: LikedListingRow): Listing {
  const originalPrice = money(
    row.original_price_minor,
    row.original_currency,
  );
  const publicId = formatPublicListingId(
    row.provider_id,
    row.source_listing_id,
  );
  const imageUrl = row.image_url ?? "/listing-image-fallback.svg";
  const observedAt = toIso(row.last_seen_at);
  const staleAt = row.stale_after ? toIso(row.stale_after) : undefined;
  const isStale =
    row.availability === "stale" ||
    (staleAt !== undefined && staleAt <= new Date().toISOString());
  const lifecycleStatus =
    row.availability === "available"
      ? "active"
      : row.availability === "sold" ||
          row.availability === "stale" ||
          row.availability === "removed" ||
          row.availability === "unavailable"
        ? row.availability
        : "unknown";
  const listingImage: ListingImage = {
    height: row.image_height ?? undefined,
    role: "primary",
    url: imageUrl,
    width: row.image_width ?? undefined,
  };

  return {
    analyticsEligibility: {
      eligible: row.analytics_eligible,
      exclusionReasons: row.analytics_eligible
        ? undefined
        : ["provider_or_listing_not_analytics_eligible"],
    },
    attribution: {
      destinationUrl: row.source_url,
      displayText: `View on ${row.source_marketplace}`,
      marketplaceName: row.source_marketplace,
      required: true,
    },
    brand: brand(row),
    category: row.category ?? undefined,
    condition: condition(row.condition),
    fetchedAt: toIso(row.fetched_at),
    freshness: {
      observedAt,
      staleAt,
      status: isStale ? "stale" : "fresh",
    },
    id: publicId,
    imageUrl,
    images: [listingImage],
    lifecycle: {
      lastSeenAt: observedAt,
      observedAt,
      status: lifecycleStatus,
    },
    listingType:
      row.listing_type === "auction" || row.listing_type === "buy_now"
        ? row.listing_type
        : "unknown",
    market: {
      askingPrice: originalPrice,
      isExcludedFromAnalytics: !row.analytics_eligible,
      status: row.market_status === "sold" ? "sold" : "active",
    },
    price: originalPrice,
    pricing: {
      original: originalPrice,
    },
    providerId: row.provider_id,
    providerListingId: row.source_listing_id,
    seller: jsonObject(row.seller_metadata) as ListingSeller | undefined,
    shipping: jsonObject(row.shipping_metadata) as ListingShipping | undefined,
    size: row.size ?? undefined,
    source: {
      dataOrigin: providerOrigin(row.provider_id),
      id: row.provider_id,
      marketplaceId: row.provider_id,
      name: row.source_marketplace,
    },
    sourceUrl: row.source_url,
    title: row.title,
  };
}

export async function listPostgresLikedListings(
  dataPlane: PostgresDataPlane,
  userId: string,
): Promise<LikedListing[]> {
  const result = await dataPlane.database.query<LikedListingRow>(
    `SELECT
       lk.id AS like_id,
       lk.user_id,
       lk.created_at AS like_created_at,
       l.provider_id,
       l.source_marketplace,
       l.source_listing_id,
       l.title,
       l.provider_brand,
       l.category,
       l.size,
       l.condition,
       l.listing_type,
       l.source_url,
       l.seller_metadata,
       l.shipping_metadata,
       l.original_price_minor,
       l.original_currency,
       l.fetched_at,
       l.analytics_eligible,
       b.id AS canonical_brand_id,
       b.slug AS canonical_brand_slug,
       b.canonical_name AS canonical_brand_name,
       state.market_status,
       state.availability,
       state.last_seen_at,
       state.stale_after,
       image.image_url,
       image.width AS image_width,
       image.height AS image_height
     FROM likes lk
     JOIN listings l ON l.id = lk.listing_id
     JOIN listing_current_state state ON state.listing_id = l.id
     LEFT JOIN brands b ON b.id = l.canonical_brand_id
     LEFT JOIN listing_images image
       ON image.listing_id = l.id
      AND image.ordinal = 0
     WHERE lk.user_id = $1
     ORDER BY lk.created_at DESC, lk.id DESC`,
    [userId],
  );

  return result.rows.map((row) => ({
    like: {
      createdAt: toIso(row.like_created_at),
      id: row.like_id,
      listingId: formatPublicListingId(
        row.provider_id,
        row.source_listing_id,
      ),
      source: row.source_marketplace,
      userId: row.user_id,
    },
    listing: listingFromRow(row),
    snapshotStatus: "snapshot",
  }));
}
