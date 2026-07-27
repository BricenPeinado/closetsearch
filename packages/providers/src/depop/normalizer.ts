import {
  resolveCanonicalBrand,
  type Listing,
  type ListingAvailabilityStatus,
  type ListingCondition,
  type ListingImage,
} from "@closetsearch/shared";
import { createMoneyFromMajor } from "../money.js";
import type { DepopRawProduct } from "./raw.js";

const providerId = "depop";
const providerName = "Depop";
const marketplaceOrigin = "https://www.depop.com";
const allowedImageHosts = new Set(["media-photos.depop.com", "pictures.depop.com"]);

function text(value: unknown) {
  return typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function timestamp(value: unknown) {
  const raw = text(value);
  const parsed = new Date(raw);
  return raw && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : undefined;
}

function marketplaceUrl(value: unknown, id: string) {
  try {
    const url = new URL(text(value) || `/products/${id}/`, marketplaceOrigin);
    return url.protocol === "https:" && url.origin === marketplaceOrigin
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function imageUrl(value: unknown) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" &&
      (allowedImageHosts.has(url.hostname) || url.hostname.endsWith(".depop.com"))
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function condition(value: unknown): ListingCondition | undefined {
  switch (text(value).toLowerCase().replace(/\s+/g, "_")) {
    case "brand_new":
    case "new_with_tags":
      return "new_with_tags";
    case "like_new":
    case "new_without_tags":
      return "new_without_tags";
    case "excellent":
      return "excellent";
    case "good":
    case "used":
      return "good";
    case "fair":
      return "fair";
    default:
      return value === undefined ? undefined : "unknown";
  }
}

function lifecycleStatus(value: unknown): ListingAvailabilityStatus {
  switch (text(value).toLowerCase()) {
    case "active":
    case "on_sale":
      return "active";
    case "sold":
    case "sold_out":
      return "sold";
    case "removed":
      return "removed";
    case "unavailable":
      return "unavailable";
    default:
      return "unknown";
  }
}

function brand(raw: DepopRawProduct) {
  return typeof raw.brand === "string"
    ? resolveCanonicalBrand(raw.brand)
    : resolveCanonicalBrand(raw.brand?.name, raw.brand?.slug);
}

export function normalizeDepopProduct(
  raw: DepopRawProduct,
  fetchedAtValue: string,
): Listing | undefined {
  const providerListingId = text(raw.id);
  const title = text(raw.title);
  const fetchedAt = timestamp(fetchedAtValue);
  const sourceUrl = marketplaceUrl(raw.itemUrl, providerListingId);
  const price = createMoneyFromMajor(
    typeof raw.price?.value === "number" || typeof raw.price?.value === "string"
      ? raw.price.value
      : "",
    raw.price?.currency,
  );
  const images = (Array.isArray(raw.images) ? raw.images : [])
    .map((image, index): ListingImage | undefined => {
      const url = imageUrl(image.url);
      return url
        ? {
            url,
            alt: title,
            role: index === 0 ? "primary" : "alternate",
            height:
              typeof image.height === "number" && image.height > 0
                ? Math.trunc(image.height)
                : undefined,
            width:
              typeof image.width === "number" && image.width > 0
                ? Math.trunc(image.width)
                : undefined,
          }
        : undefined;
    })
    .filter((image): image is ListingImage => image !== undefined);

  if (!providerListingId || !title || !fetchedAt || !sourceUrl || !price || images.length === 0) {
    return undefined;
  }

  const status = lifecycleStatus(raw.status);
  const listedAt = timestamp(raw.publishedAt);
  const sourceUpdatedAt = timestamp(raw.updatedAt);
  const description = text(raw.description) || undefined;
  const shippingCost =
    raw.shipping?.cost &&
    (typeof raw.shipping.cost.value === "number" || typeof raw.shipping.cost.value === "string")
      ? createMoneyFromMajor(raw.shipping.cost.value, raw.shipping.cost.currency)
      : undefined;
  const confirmedMarketStatus =
    status === "sold" ? "sold" : status === "active" ? "active" : undefined;

  return {
    id: `${providerId}:${providerListingId}`,
    providerId,
    providerListingId,
    source: {
      id: providerId,
      name: providerName,
      dataOrigin: "authorized_scraping",
      isMock: false,
    },
    sourceUrl,
    title,
    description,
    brand: brand(raw),
    imageUrl: images[0]?.url ?? "",
    images,
    price,
    pricing: {
      original: price,
      shipping: shippingCost,
    },
    category: text(raw.category) || undefined,
    size: text(raw.size) || undefined,
    condition: condition(raw.condition),
    listingType: "buy_now",
    fetchedAt,
    analyticsEligibility: {
      eligible: Boolean(confirmedMarketStatus),
      exclusionReasons: confirmedMarketStatus ? undefined : ["unconfirmed_marketplace_status"],
    },
    attribution: {
      destinationUrl: sourceUrl,
      displayText: "View on Depop",
      marketplaceName: providerName,
      required: true,
    },
    freshness: {
      observedAt: fetchedAt,
      sourceUpdatedAt,
      status: "fresh",
    },
    lifecycle: {
      lastSeenAt: fetchedAt,
      listedAt,
      observedAt: fetchedAt,
      relistedFromProviderListingId: text(raw.relistedFromId) || undefined,
      soldAt: status === "sold" ? sourceUpdatedAt : undefined,
      sourceUpdatedAt,
      status,
    },
    seller:
      text(raw.seller?.username) || text(raw.seller?.id)
        ? {
            id: text(raw.seller?.id) || undefined,
            username: text(raw.seller?.username) || undefined,
            displayName: text(raw.seller?.username) || undefined,
          }
        : undefined,
    shipping:
      raw.shipping || shippingCost
        ? {
            available: true,
            cost: shippingCost,
            originCountry: "US",
            payer:
              raw.shipping?.payer === "seller"
                ? "seller"
                : raw.shipping?.payer === "buyer"
                  ? "buyer"
                  : "unknown",
            type: raw.shipping?.domesticOnly ? "domestic_only" : undefined,
          }
        : undefined,
    market: confirmedMarketStatus
      ? {
          status: confirmedMarketStatus,
          askingPrice: confirmedMarketStatus === "active" ? price : undefined,
          soldPrice: confirmedMarketStatus === "sold" ? price : undefined,
          isExcludedFromAnalytics: false,
        }
      : undefined,
    marketplaceLimitations: {
      closetSearchRole: "discovery_only",
      internationalShipping: raw.shipping?.domesticOnly ? "domestic_only" : "unknown",
    },
  };
}
