import {
  resolveCanonicalBrand,
  type Listing,
  type ListingCondition,
  type ListingImage,
  type ListingSeller,
  type ListingShipping,
  type ListingType,
  type Money,
  type SellerTrustTier,
} from "@closetsearch/shared";
import { createMoneyFromMajor } from "../money.js";
import type {
  EbayRawAspect,
  EbayRawImage,
  EbayRawItemSummary,
  EbayRawShippingOption,
} from "./raw.js";

const ebayProviderId = "ebay";
const ebayProviderName = "eBay";

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHttpUrl(value: unknown) {
  const normalizedValue = toTrimmedString(value);

  if (!normalizedValue) {
    return undefined;
  }

  try {
    const url = new URL(normalizedValue);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeTimestamp(value: unknown) {
  const normalizedValue = toTrimmedString(value);
  const timestamp = new Date(normalizedValue);
  return normalizedValue && !Number.isNaN(timestamp.valueOf())
    ? timestamp.toISOString()
    : undefined;
}

function findAspect(aspects: EbayRawAspect[] | undefined, name: string) {
  return aspects?.find(
    (aspect) => toTrimmedString(aspect.name).toLowerCase() === name.toLowerCase(),
  )?.value;
}

function normalizeBrand(raw: EbayRawItemSummary) {
  const name = toTrimmedString(findAspect(raw.localizedAspects, "Brand")) ||
    "Unknown brand";
  return resolveCanonicalBrand(name);
}

function normalizeCondition(value: unknown): ListingCondition | undefined {
  const condition = toTrimmedString(value).toLowerCase();

  if (!condition) {
    return undefined;
  }

  if (
    condition.includes("new with tags") ||
    condition === "new" ||
    condition.includes("brand new")
  ) {
    return "new_with_tags";
  }

  if (
    condition.includes("new without tags") ||
    condition.includes("new other")
  ) {
    return "new_without_tags";
  }

  if (
    condition.includes("excellent") ||
    condition.includes("like new")
  ) {
    return "excellent";
  }

  if (
    condition.includes("good") ||
    condition.includes("pre-owned") ||
    condition.includes("used")
  ) {
    return "good";
  }

  if (
    condition.includes("fair") ||
    condition.includes("acceptable") ||
    condition.includes("parts")
  ) {
    return "fair";
  }

  return "unknown";
}

function normalizeListingType(buyingOptions: string[] | undefined): ListingType {
  const normalizedOptions = (buyingOptions ?? []).map((option) =>
    option.trim().toUpperCase(),
  );

  if (normalizedOptions.includes("AUCTION")) {
    return "auction";
  }

  if (normalizedOptions.includes("FIXED_PRICE")) {
    return "buy_now";
  }

  return "unknown";
}

function normalizeImage(
  raw: EbayRawImage,
  role: ListingImage["role"],
  title: string,
): ListingImage | undefined {
  const url = normalizeHttpUrl(raw.imageUrl);

  if (!url) {
    return undefined;
  }

  const width =
    typeof raw.width === "number" && Number.isFinite(raw.width) && raw.width > 0
      ? Math.trunc(raw.width)
      : undefined;
  const height =
    typeof raw.height === "number" && Number.isFinite(raw.height) && raw.height > 0
      ? Math.trunc(raw.height)
      : undefined;

  return {
    url,
    role,
    alt: title,
    width,
    height,
  };
}

function normalizeImages(raw: EbayRawItemSummary, title: string) {
  const candidates = [
    raw.image ? normalizeImage(raw.image, "primary", title) : undefined,
    ...(raw.additionalImages ?? []).map((image) =>
      normalizeImage(image, "alternate", title),
    ),
    ...(raw.thumbnailImages ?? []).map((image) =>
      normalizeImage(image, "thumbnail", title),
    ),
  ].filter((image): image is ListingImage => image !== undefined);
  const seenUrls = new Set<string>();

  return candidates.filter((image) => {
    if (seenUrls.has(image.url)) {
      return false;
    }

    seenUrls.add(image.url);
    return true;
  });
}

function normalizeTrustTier(
  feedbackPercentage: number | undefined,
  feedbackCount: number | undefined,
): SellerTrustTier {
  if (feedbackPercentage === undefined && feedbackCount === undefined) {
    return "unknown";
  }

  if ((feedbackPercentage ?? 0) >= 99 && (feedbackCount ?? 0) >= 100) {
    return "trusted";
  }

  if ((feedbackPercentage ?? 0) >= 95 && (feedbackCount ?? 0) >= 10) {
    return "established";
  }

  return "unverified";
}

function normalizeSeller(raw: EbayRawItemSummary): ListingSeller | undefined {
  const username = toTrimmedString(raw.seller?.username) || undefined;
  const feedbackCount =
    typeof raw.seller?.feedbackScore === "number" &&
    Number.isFinite(raw.seller.feedbackScore) &&
    raw.seller.feedbackScore >= 0
      ? Math.trunc(raw.seller.feedbackScore)
      : undefined;
  const feedbackPercentageValue = Number(raw.seller?.feedbackPercentage);
  const feedbackPercentage =
    Number.isFinite(feedbackPercentageValue) &&
    feedbackPercentageValue >= 0 &&
    feedbackPercentageValue <= 100
      ? feedbackPercentageValue
      : undefined;

  if (!username && feedbackCount === undefined && feedbackPercentage === undefined) {
    return undefined;
  }

  return {
    username,
    displayName: username,
    feedbackCount,
    feedbackPercentage,
    trustTier: normalizeTrustTier(feedbackPercentage, feedbackCount),
  };
}

function normalizeShippingOption(
  raw: EbayRawShippingOption,
): ListingShipping | undefined {
  const cost = createMoneyFromMajor(
    toTrimmedString(raw.shippingCost?.value),
    raw.shippingCost?.currency,
  );
  const minEstimatedDeliveryAt = normalizeTimestamp(
    raw.minEstimatedDeliveryDate,
  );
  const maxEstimatedDeliveryAt = normalizeTimestamp(
    raw.maxEstimatedDeliveryDate,
  );
  const type =
    toTrimmedString(raw.shippingCostType) ||
    toTrimmedString(raw.type) ||
    undefined;

  if (!cost && !minEstimatedDeliveryAt && !maxEstimatedDeliveryAt && !type) {
    return undefined;
  }

  return {
    available: true,
    cost,
    isFree: cost?.amountMinor === 0,
    maxEstimatedDeliveryAt,
    minEstimatedDeliveryAt,
    type,
  };
}

function getLowestShipping(
  options: EbayRawShippingOption[] | undefined,
  price: Money,
): ListingShipping | undefined {
  const normalizedOptions = (options ?? [])
    .map(normalizeShippingOption)
    .filter((option): option is ListingShipping => option !== undefined);

  return normalizedOptions.sort((left, right) => {
    const leftCost =
      left.cost?.currency === price.currency
        ? left.cost.amountMinor ?? Number.MAX_SAFE_INTEGER
        : Number.MAX_SAFE_INTEGER;
    const rightCost =
      right.cost?.currency === price.currency
        ? right.cost.amountMinor ?? Number.MAX_SAFE_INTEGER
        : Number.MAX_SAFE_INTEGER;
    return leftCost - rightCost;
  })[0];
}

function addMoney(left: Money, right: Money | undefined): Money | undefined {
  if (
    !right ||
    left.currency !== right.currency ||
    left.amountMinor === undefined ||
    right.amountMinor === undefined ||
    left.fractionDigits !== right.fractionDigits
  ) {
    return undefined;
  }

  const amountMinor = left.amountMinor + right.amountMinor;

  if (!Number.isSafeInteger(amountMinor)) {
    return undefined;
  }

  return {
    amount: left.amount + right.amount,
    amountMinor,
    currency: left.currency,
    fractionDigits: left.fractionDigits,
  };
}

export function normalizeEbayItemSummary(
  raw: EbayRawItemSummary,
  fetchedAtValue: string,
): Listing | null {
  const fetchedAt = normalizeTimestamp(fetchedAtValue);
  const providerListingId = toTrimmedString(raw.itemId);
  const title = toTrimmedString(raw.title);
  const sourceUrl = normalizeHttpUrl(
    raw.itemAffiliateWebUrl || raw.itemWebUrl,
  );
  const priceAmount = raw.price ?? raw.currentBidPrice;
  const price = createMoneyFromMajor(
    toTrimmedString(priceAmount?.value),
    priceAmount?.currency,
  );
  const images = normalizeImages(raw, title);
  const listedAt =
    normalizeTimestamp(raw.itemOriginDate) ??
    normalizeTimestamp(raw.itemCreationDate);
  const endedAt = normalizeTimestamp(raw.itemEndDate);

  if (
    !fetchedAt ||
    !providerListingId ||
    !title ||
    !sourceUrl ||
    !price ||
    images.length === 0 ||
    raw.adultOnly === true
  ) {
    return null;
  }

  if (endedAt && new Date(endedAt).valueOf() <= new Date(fetchedAt).valueOf()) {
    return null;
  }

  const shipping = getLowestShipping(raw.shippingOptions, price);
  const landed = addMoney(price, shipping?.cost);
  const category =
    [...(raw.categories ?? [])]
      .reverse()
      .map((entry) => toTrimmedString(entry.categoryName))
      .find(Boolean) ??
    toTrimmedString(raw.categoryPath).split("|").filter(Boolean).at(-1);
  const seller = normalizeSeller(raw);
  const sellerIsUnverified = seller?.trustTier === "unverified";

  return {
    id: `${ebayProviderId}:${providerListingId}`,
    providerId: ebayProviderId,
    providerListingId,
    source: {
      id: ebayProviderId,
      name: ebayProviderName,
      dataOrigin: "official_api",
      isMock: false,
      marketplaceId:
        toTrimmedString(raw.listingMarketplaceId) || undefined,
    },
    sourceUrl,
    title,
    brand: normalizeBrand(raw),
    imageUrl: images[0]?.url ?? "",
    images,
    price,
    pricing: {
      original: price,
      shipping: shipping?.cost,
      landed,
    },
    category: category || undefined,
    size: toTrimmedString(findAspect(raw.localizedAspects, "Size")) || undefined,
    condition: normalizeCondition(raw.condition),
    listingType: normalizeListingType(raw.buyingOptions),
    fetchedAt,
    analyticsEligibility: {
      eligible: !sellerIsUnverified,
      exclusionReasons: sellerIsUnverified
        ? ["seller_metadata_below_provider_confidence_gate"]
        : undefined,
    },
    attribution: {
      affiliate: Boolean(normalizeHttpUrl(raw.itemAffiliateWebUrl)),
      destinationUrl: sourceUrl,
      displayText: "View on eBay",
      marketplaceName: ebayProviderName,
      required: true,
    },
    freshness: {
      observedAt: fetchedAt,
      status: "fresh",
    },
    lifecycle: {
      endedAt,
      lastSeenAt: fetchedAt,
      listedAt,
      observedAt: fetchedAt,
      status: "active",
    },
    seller,
    shipping: shipping
      ? {
          ...shipping,
          originCountry:
            toTrimmedString(raw.itemLocation?.country) || undefined,
        }
      : undefined,
    market: {
      status: "active",
      askingPrice: price,
      isExcludedFromAnalytics: sellerIsUnverified,
    },
  };
}
