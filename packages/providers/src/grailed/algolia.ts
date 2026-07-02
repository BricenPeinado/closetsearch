import type {
  Listing,
  ListingCondition,
  ListingMarketStatus,
  ListingSeller,
  SellerTrustTier,
} from "@closetsearch/shared";
import type { ProviderSearchQuery } from "../types";
import type { GrailedAlgoliaCredentials } from "./credentials";
import type { GrailedJsonClientResponse } from "./http-client";

const activeListingsIndex = "Listing_production";
const soldListingsIndex = "Listing_sold_production";
export const GRAILED_ALGOLIA_HITS_PER_PAGE = 100;

type GrailedAlgoliaHit = Record<string, unknown>;

export interface GrailedAlgoliaResponse {
  hits?: GrailedAlgoliaHit[];
  hitsPerPage?: number;
  nbHits?: number;
  nbPages?: number;
  page?: number;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  }

  return undefined;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const normalizedValue = asNumber(value);

    if (normalizedValue !== undefined) {
      return normalizedValue;
    }
  }

  return undefined;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePath(
  pathOrUrl: string | undefined,
  providerListingId: string,
  baseUrl: string,
) {
  const value = firstString(pathOrUrl);

  if (value?.startsWith("http://") || value?.startsWith("https://")) {
    return value;
  }

  const normalizedPath = value || `/listings/${providerListingId}`;
  return `${baseUrl}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}

function normalizeListingType(value: unknown) {
  switch (firstString(value)?.toLowerCase()) {
    case "auction":
      return "auction" as const;
    case "buy_now":
    case "fixed_price":
    case "instant":
      return "buy_now" as const;
    default:
      return "unknown" as const;
  }
}

function normalizeCondition(value: unknown): ListingCondition | undefined {
  switch (firstString(value)?.toLowerCase()) {
    case "new":
    case "new_with_tags":
    case "nwt":
      return "new_with_tags";
    case "new_without_tags":
    case "nwot":
      return "new_without_tags";
    case "excellent":
      return "excellent";
    case "good":
      return "good";
    case "fair":
      return "fair";
    case "unknown":
      return "unknown";
    default:
      return undefined;
  }
}

function normalizeSellerTrustTier(
  feedbackScore: number | undefined,
  feedbackCount: number | undefined,
): SellerTrustTier {
  if (feedbackScore === undefined && feedbackCount === undefined) {
    return "unknown";
  }

  if ((feedbackScore ?? 0) >= 4.8 && (feedbackCount ?? 0) >= 25) {
    return "trusted";
  }

  if ((feedbackScore ?? 0) >= 4 && (feedbackCount ?? 0) >= 5) {
    return "established";
  }

  return "unverified";
}

function normalizeSeller(hit: GrailedAlgoliaHit): ListingSeller | undefined {
  const seller = asRecord(hit.seller);
  const feedbackScore = firstNumber(
    seller?.feedback_score,
    seller?.feedbackScore,
    hit.seller_feedback_score,
    hit.sellerFeedbackScore,
  );
  const feedbackCount = firstNumber(
    seller?.feedback_count,
    seller?.feedbackCount,
    seller?.transactions_count,
    hit.seller_feedback_count,
    hit.sellerFeedbackCount,
  );
  const username = firstString(
    seller?.username,
    seller?.name,
    hit.seller_username,
    hit.sellerName,
  );
  const trustTier = normalizeSellerTrustTier(feedbackScore, feedbackCount);

  if (
    !username &&
    feedbackScore === undefined &&
    feedbackCount === undefined &&
    trustTier === "unknown"
  ) {
    return undefined;
  }

  return {
    username,
    feedbackScore,
    feedbackCount,
    trustTier,
  };
}

export function getGrailedIndexName(
  marketScope: ListingMarketStatus | undefined,
) {
  return marketScope === "sold" ? soldListingsIndex : activeListingsIndex;
}

export function createGrailedAlgoliaQueryPayload(
  query: ProviderSearchQuery,
  page: number,
) {
  const params = new URLSearchParams({
    hitsPerPage: String(GRAILED_ALGOLIA_HITS_PER_PAGE),
    page: String(Math.max(0, page - 1)),
    query: query.text,
  });

  if (query.marketScope === "sold") {
    params.set("analytics", "false");
  }

  return {
    params: params.toString(),
  };
}

export async function queryGrailedAlgolia(
  client: {
    postJson<T>(
      url: string,
      body: unknown,
      headers?: Record<string, string>,
    ): Promise<GrailedJsonClientResponse<T>>;
  },
  options: {
    baseUrl: string;
    credentials: GrailedAlgoliaCredentials;
    marketScope?: ListingMarketStatus;
    page: number;
    query: ProviderSearchQuery;
  },
) {
  const indexName = getGrailedIndexName(options.marketScope);
  const url = `https://${options.credentials.appId}-dsn.algolia.net/1/indexes/${indexName}/query`;

  return client.postJson<GrailedAlgoliaResponse>(
    url,
    createGrailedAlgoliaQueryPayload(options.query, options.page),
    {
      origin: options.baseUrl,
      referer: `${options.baseUrl}/`,
      "x-algolia-agent": "ClosetSearch Grailed Provider",
      "x-algolia-api-key": options.credentials.apiKey,
      "x-algolia-application-id": options.credentials.appId,
    },
  );
}

export function normalizeGrailedAlgoliaHit(
  hit: GrailedAlgoliaHit,
  options: {
    baseUrl: string;
    fetchedAt: string;
    marketScope?: ListingMarketStatus;
  },
): Listing {
  const providerListingId =
    firstString(hit.objectID, hit.id, hit.slug) ?? "generated-grailed-hit";
  const designer = asRecord(hit.designer) ?? asRecord(hit.brand);
  const firstDesigner = Array.isArray(hit.designers)
    ? asRecord(hit.designers[0])
    : undefined;
  const brandName =
    firstString(
      designer?.name,
      firstDesigner?.name,
      hit.brand_name,
      hit.brand,
    ) ?? "Unknown Brand";
  const generatedBrandSlug = slugify(brandName);
  const brandSlug =
    firstString(designer?.slug, firstDesigner?.slug, hit.brand_slug) ??
    (generatedBrandSlug.length > 0 ? generatedBrandSlug : "unknown-brand");
  const priceInCents =
    firstNumber(
      hit.price_in_cents,
      hit.priceInCents,
      hit.sold_price_in_cents,
      asRecord(hit.price)?.amount,
    ) ?? 0;
  const currency =
    firstString(hit.currency, asRecord(hit.price)?.currency, "USD") ?? "USD";
  const seller = normalizeSeller(hit);
  const trustTier = seller?.trustTier ?? "unknown";
  const tags = asStringArray(hit.tags) ?? asStringArray(hit.metadata_tags);
  const priceDropsCount = firstNumber(
    hit.price_drops_count,
    hit.priceDropsCount,
  );
  const marketStatus = options.marketScope ?? "active";

  return {
    id: `grailed:${providerListingId}`,
    providerId: "grailed",
    providerListingId,
    source: {
      id: "grailed",
      name: "Grailed",
    },
    sourceUrl: normalizePath(
      firstString(hit.url, hit.path, hit.canonical_path),
      providerListingId,
      options.baseUrl,
    ),
    title: firstString(hit.title, hit.full_title, hit.name) ?? "Grailed listing",
    brand: {
      id: `brand:${brandSlug}`,
      slug: brandSlug,
      name: brandName,
    },
    imageUrl:
      firstString(
        hit.image_url,
        hit.photo_url,
        asRecord(hit.cover_photo)?.url,
        asRecord(hit.photo)?.url,
      ) ?? "https://closetsearch.dev/placeholders/grailed-listing.png",
    price: {
      amount: Math.max(0, priceInCents / 100),
      currency,
    },
    category: firstString(hit.category, hit.category_name),
    size: firstString(hit.size, hit.size_label, hit.size_name),
    condition: normalizeCondition(hit.condition),
    listingType: normalizeListingType(hit.listing_type ?? hit.sale_type),
    fetchedAt:
      firstString(hit.updated_at, hit.created_at, options.fetchedAt) ??
      options.fetchedAt,
    seller,
    market: {
      status: marketStatus,
      tags,
      priceDropsCount,
      isExcludedFromAnalytics: trustTier === "unverified",
    },
  };
}

export function createGrailedPagination(
  response: GrailedAlgoliaResponse,
  providerPage: number,
) {
  const totalCount = firstNumber(response.nbHits);
  const totalPages = firstNumber(response.nbPages);
  const hasMore = totalPages !== undefined ? providerPage < totalPages : false;

  return {
    page: providerPage,
    pageSize:
      firstNumber(response.hitsPerPage, GRAILED_ALGOLIA_HITS_PER_PAGE) ??
      GRAILED_ALGOLIA_HITS_PER_PAGE,
    hasMore,
    nextPage: hasMore ? providerPage + 1 : undefined,
    totalCount,
  };
}
