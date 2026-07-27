import {
  resolveCanonicalBrand,
  type Listing,
  type ListingAvailabilityStatus,
  type ListingCondition,
  type ListingImage,
} from "@closetsearch/shared";
import { createMoneyFromMajor } from "../money.js";
import type { MercariJpRawItem } from "./raw.js";

const providerId = "mercari-jp";
const providerName = "Mercari Japan";
const marketplaceOrigin = "https://jp.mercari.com";
const allowedImageHosts = new Set(["static.mercdn.net", "assets.mercari-shops-static.com"]);

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

function listingUrl(value: unknown, id: string) {
  try {
    const url = new URL(text(value) || `/item/${encodeURIComponent(id)}`, marketplaceOrigin);
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
    return url.protocol === "https:" && allowedImageHosts.has(url.hostname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function condition(value: unknown): ListingCondition | undefined {
  const normalized = text(value).toLowerCase();
  if (!normalized) return undefined;
  if (/新品|未使用/.test(normalized)) return "new_with_tags";
  if (/未使用に近い/.test(normalized)) return "excellent";
  if (/目立った傷/.test(normalized)) return "good";
  if (/傷|汚れ/.test(normalized)) return "fair";
  return "unknown";
}

function lifecycleStatus(value: unknown): ListingAvailabilityStatus {
  switch (text(value).toLowerCase()) {
    case "on_sale":
    case "active":
      return "active";
    case "sold_out":
    case "sold":
      return "sold";
    case "removed":
      return "removed";
    case "unavailable":
    case "deleted":
      return "unavailable";
    default:
      return "unknown";
  }
}

export function normalizeMercariJpItem(
  raw: MercariJpRawItem,
  fetchedAtValue: string,
): Listing | undefined {
  const providerListingId = text(raw.id);
  const originalTitle = text(raw.name);
  const translatedTitle = text(raw.translatedName) || undefined;
  const title = translatedTitle ?? originalTitle;
  const fetchedAt = timestamp(fetchedAtValue);
  const sourceUrl = listingUrl(raw.itemUrl, providerListingId);
  const price =
    typeof raw.price === "number" || typeof raw.price === "string"
      ? createMoneyFromMajor(raw.price, "JPY")
      : undefined;
  const images = (Array.isArray(raw.images) ? raw.images : [])
    .map((image, index): ListingImage | undefined => {
      const url = imageUrl(image.url);
      return url
        ? {
            url,
            alt: originalTitle,
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

  if (
    !providerListingId ||
    !originalTitle ||
    !fetchedAt ||
    !sourceUrl ||
    !price ||
    images.length === 0
  ) {
    return undefined;
  }

  const status = lifecycleStatus(raw.status);
  const confirmedMarketStatus =
    status === "sold" ? "sold" : status === "active" ? "active" : undefined;
  const sourceUpdatedAt = timestamp(raw.updatedAt);
  const originalDescription = text(raw.description) || undefined;
  const translatedDescription = text(raw.translatedDescription) || undefined;
  const domesticOnly = raw.shipping?.domesticOnly !== false;

  return {
    id: `${providerId}:${providerListingId}`,
    providerId,
    providerListingId,
    source: {
      id: providerId,
      name: providerName,
      dataOrigin: "authorized_scraping",
      isMock: false,
      marketplaceId: "MERCARI_JP",
    },
    sourceUrl,
    title,
    description: translatedDescription ?? originalDescription,
    originalTitle,
    originalDescription,
    originalLanguage: "ja",
    translatedTitle,
    translatedDescription,
    brand: resolveCanonicalBrand(raw.brand?.name, raw.brand?.translatedName),
    imageUrl: images[0]?.url ?? "",
    images,
    price,
    pricing: { original: price },
    category: text(raw.category) || undefined,
    color: text(raw.color) || undefined,
    material: text(raw.material) || undefined,
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
      displayText: "View on Mercari Japan",
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
      listedAt: timestamp(raw.createdAt),
      observedAt: fetchedAt,
      relistedFromProviderListingId: text(raw.relistedFromItemId) || undefined,
      soldAt: status === "sold" ? sourceUpdatedAt : undefined,
      sourceUpdatedAt,
      status,
    },
    seller:
      text(raw.seller?.name) || text(raw.seller?.id)
        ? {
            id: text(raw.seller?.id) || undefined,
            username: text(raw.seller?.name) || undefined,
            displayName: text(raw.seller?.name) || undefined,
            feedbackCount:
              typeof raw.seller?.ratingCount === "number" &&
              Number.isSafeInteger(raw.seller.ratingCount) &&
              raw.seller.ratingCount >= 0
                ? raw.seller.ratingCount
                : undefined,
          }
        : undefined,
    shipping: raw.shipping
      ? {
          available: true,
          originCountry: "JP",
          payer:
            raw.shipping.feeBearer === "seller"
              ? "seller"
              : raw.shipping.feeBearer === "buyer"
                ? "buyer"
                : "unknown",
          type: [text(raw.shipping.method), domesticOnly ? "domestic_only" : ""]
            .filter(Boolean)
            .join(" · "),
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
      internationalShipping: domesticOnly ? "proxy_only" : "unknown",
      proxyPurchaseRequired: domesticOnly,
      notices: domesticOnly
        ? [
            "Domestic Japan shipping only; an independent proxy service may be required.",
            "ClosetSearch is a discovery service, not the seller or purchasing agent.",
          ]
        : ["ClosetSearch is a discovery service, not the seller or purchasing agent."],
    },
  };
}
