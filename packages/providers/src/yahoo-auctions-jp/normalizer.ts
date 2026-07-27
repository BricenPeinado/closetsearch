import {
  resolveCanonicalBrand,
  type Listing,
  type ListingAvailabilityStatus,
  type ListingCondition,
  type ListingImage,
  type Money,
} from "@closetsearch/shared";
import { createMoneyFromMajor } from "../money.js";
import type { YahooAuctionsJpRawListing, YahooAuctionsJpRawMoney } from "./raw.js";

const providerId = "yahoo-auctions-jp";
const providerName = "Yahoo! Auctions Japan";
const allowedListingOrigins = new Set([
  "https://auctions.yahoo.co.jp",
  "https://page.auctions.yahoo.co.jp",
]);

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

function listingUrl(value: unknown, auctionId: string) {
  try {
    const url = new URL(
      text(value) || `/jp/auction/${encodeURIComponent(auctionId)}`,
      "https://page.auctions.yahoo.co.jp",
    );
    return url.protocol === "https:" && allowedListingOrigins.has(url.origin)
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
      (url.hostname === "auctions.c.yimg.jp" || url.hostname.endsWith(".yimg.jp"))
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function money(value: YahooAuctionsJpRawMoney | undefined): Money | undefined {
  return value && (typeof value.value === "number" || typeof value.value === "string")
    ? createMoneyFromMajor(value.value, value.currency)
    : undefined;
}

function condition(value: unknown): ListingCondition | undefined {
  const normalized = text(value).toLowerCase();
  if (!normalized) return undefined;
  if (/新品|未使用|new with tags/.test(normalized)) return "new_with_tags";
  if (/未使用に近い|like new/.test(normalized)) return "excellent";
  if (/目立った傷|good/.test(normalized)) return "good";
  if (/傷|汚れ|fair/.test(normalized)) return "fair";
  return "unknown";
}

function lifecycleStatus(value: unknown, hasCompletedPrice: boolean): ListingAvailabilityStatus {
  switch (text(value).toLowerCase()) {
    case "active":
    case "open":
      return "active";
    case "sold":
      return hasCompletedPrice ? "sold" : "unavailable";
    case "expired":
    case "ended":
    case "closed":
      return "unavailable";
    case "removed":
      return "removed";
    default:
      return "unknown";
  }
}

export function normalizeYahooAuctionsJpListing(
  raw: YahooAuctionsJpRawListing,
  fetchedAtValue: string,
): Listing | undefined {
  const providerListingId = text(raw.auctionId);
  const originalTitle = text(raw.title);
  const translatedTitle = text(raw.translatedTitle) || undefined;
  const title = translatedTitle ?? originalTitle;
  const fetchedAt = timestamp(fetchedAtValue);
  const sourceUrl = listingUrl(raw.itemUrl, providerListingId);
  const currentBid = money(raw.currentBid);
  const buyNowPrice = money(raw.buyNowPrice);
  const completedPrice = money(raw.completedPrice);
  const price = completedPrice ?? currentBid ?? buyNowPrice;
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
    price.currency !== "JPY" ||
    images.length === 0
  ) {
    return undefined;
  }

  const isAuction = text(raw.format).toLowerCase() !== "fixed_price";
  const status = lifecycleStatus(raw.status, Boolean(completedPrice));
  const confirmedMarketStatus =
    status === "sold" && completedPrice ? "sold" : status === "active" ? "active" : undefined;
  const originalDescription = text(raw.description) || undefined;
  const translatedDescription = text(raw.translatedDescription) || undefined;
  const sourceUpdatedAt = timestamp(raw.updatedAt);
  const endsAt = timestamp(raw.auctionEndTime);
  const shippingCost = money(raw.shipping?.cost);

  return {
    id: `${providerId}:${providerListingId}`,
    providerId,
    providerListingId,
    source: {
      id: providerId,
      name: providerName,
      dataOrigin: "authorized_scraping",
      isMock: false,
      marketplaceId: "YAHOO_AUCTIONS_JP",
    },
    sourceUrl,
    title,
    description: translatedDescription ?? originalDescription,
    originalTitle,
    originalDescription,
    originalLanguage: "ja",
    translatedTitle,
    translatedDescription,
    brand: resolveCanonicalBrand(raw.brand, raw.brandAlias),
    imageUrl: images[0]?.url ?? "",
    images,
    price,
    pricing: {
      original: price,
      shipping: shippingCost,
    },
    category: text(raw.category) || undefined,
    color: text(raw.color) || undefined,
    material: text(raw.material) || undefined,
    size: text(raw.size) || undefined,
    condition: condition(raw.condition),
    listingType: isAuction ? "auction" : "buy_now",
    auction: isAuction
      ? {
          currentBid,
          buyNowPrice,
          completedPrice: status === "sold" ? completedPrice : undefined,
          bidCount:
            typeof raw.bidCount === "number" &&
            Number.isSafeInteger(raw.bidCount) &&
            raw.bidCount >= 0
              ? raw.bidCount
              : undefined,
          endsAt,
        }
      : undefined,
    fetchedAt,
    analyticsEligibility: {
      eligible: Boolean(confirmedMarketStatus),
      exclusionReasons: confirmedMarketStatus ? undefined : ["auction_outcome_not_confirmed"],
    },
    attribution: {
      destinationUrl: sourceUrl,
      displayText: "View on Yahoo! Auctions Japan",
      marketplaceName: providerName,
      required: true,
    },
    freshness: {
      observedAt: fetchedAt,
      sourceUpdatedAt,
      status: "fresh",
    },
    lifecycle: {
      endedAt: endsAt,
      lastSeenAt: fetchedAt,
      listedAt: timestamp(raw.startTime),
      observedAt: fetchedAt,
      relistedFromProviderListingId: text(raw.relistedFromAuctionId) || undefined,
      soldAt: status === "sold" ? (endsAt ?? sourceUpdatedAt) : undefined,
      sourceUpdatedAt,
      status,
    },
    seller:
      text(raw.seller?.username) || text(raw.seller?.id)
        ? {
            id: text(raw.seller?.id) || undefined,
            username: text(raw.seller?.username) || undefined,
            displayName: text(raw.seller?.username) || undefined,
            feedbackPercentage:
              typeof raw.seller?.rating === "number" &&
              raw.seller.rating >= 0 &&
              raw.seller.rating <= 100
                ? raw.seller.rating
                : undefined,
          }
        : undefined,
    shipping:
      raw.shipping || shippingCost
        ? {
            available: true,
            cost: shippingCost,
            originCountry: "JP",
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
          askingPrice:
            confirmedMarketStatus === "active" && !isAuction ? (buyNowPrice ?? price) : undefined,
          soldPrice: confirmedMarketStatus === "sold" ? completedPrice : undefined,
          isExcludedFromAnalytics: false,
        }
      : undefined,
    marketplaceLimitations: {
      closetSearchRole: "discovery_only",
      internationalShipping: raw.shipping?.domesticOnly ? "proxy_only" : "unknown",
      proxyPurchaseRequired: raw.shipping?.domesticOnly === true,
      notices: raw.shipping?.domesticOnly
        ? [
            "Domestic Japan shipping only; an independent proxy service may be required.",
            "ClosetSearch is a discovery service, not the seller or purchasing agent.",
          ]
        : ["ClosetSearch is a discovery service, not the seller or purchasing agent."],
    },
  };
}
