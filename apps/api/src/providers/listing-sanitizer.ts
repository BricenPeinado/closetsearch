import type {
  Brand,
  ConvertedMoney,
  Listing,
  ListingAnalyticsEligibility,
  ListingAttribution,
  ListingFreshness,
  ListingImage,
  ListingLifecycle,
  ListingMarketMetrics,
  ListingPricing,
  ListingSeller,
  ListingShipping,
  ListingSource,
  Money,
} from "@closetsearch/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeOptionalString(value: unknown) {
  return value === undefined
    ? undefined
    : isNonEmptyString(value)
      ? value.trim()
      : null;
}

function sanitizeStringArray(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    return null;
  }

  return value.map((entry) => entry.trim());
}

function sanitizeHttpUrl(value: unknown) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function sanitizeOptionalHttpUrl(value: unknown) {
  return value === undefined ? undefined : sanitizeHttpUrl(value);
}

function sanitizeTimestamp(value: unknown) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const timestamp = new Date(value.trim());
  return Number.isNaN(timestamp.valueOf()) ? null : timestamp.toISOString();
}

function sanitizeOptionalTimestamp(value: unknown) {
  return value === undefined ? undefined : sanitizeTimestamp(value);
}

function sanitizeCurrency(value: unknown) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function sanitizeMoney(value: unknown): Money | null {
  if (!isRecord(value)) {
    return null;
  }

  const amount = value.amount;
  const currency = sanitizeCurrency(value.currency);
  const hasAmountMinor = value.amountMinor !== undefined;
  const hasFractionDigits = value.fractionDigits !== undefined;

  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    !currency ||
    hasAmountMinor !== hasFractionDigits
  ) {
    return null;
  }

  if (!hasAmountMinor) {
    return { amount, currency };
  }

  const amountMinor = value.amountMinor;
  const fractionDigits = value.fractionDigits;

  if (
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    typeof fractionDigits !== "number" ||
    !Number.isInteger(fractionDigits) ||
    fractionDigits < 0 ||
    fractionDigits > 6 ||
    Math.round(amount * 10 ** fractionDigits) !== amountMinor
  ) {
    return null;
  }

  return {
    amount,
    amountMinor,
    currency,
    fractionDigits,
  };
}

function sanitizeOptionalMoney(value: unknown) {
  return value === undefined ? undefined : sanitizeMoney(value);
}

function sanitizeConvertedMoney(value: unknown): ConvertedMoney | null {
  const money = sanitizeMoney(value);

  if (!money || !isRecord(value)) {
    return null;
  }

  const exchangeRate = sanitizeOptionalString(value.exchangeRate);
  const exchangeRateSource = sanitizeOptionalString(value.exchangeRateSource);
  const exchangeRateTimestamp = sanitizeTimestamp(value.exchangeRateTimestamp);
  const sourceCurrency = sanitizeCurrency(value.sourceCurrency);
  const sourceAmountMinor = value.sourceAmountMinor;

  if (
    !exchangeRate ||
    !/^\d+(?:\.\d+)?$/.test(exchangeRate) ||
    Number(exchangeRate) <= 0 ||
    !exchangeRateSource ||
    !exchangeRateTimestamp ||
    !sourceCurrency ||
    typeof sourceAmountMinor !== "number" ||
    !Number.isSafeInteger(sourceAmountMinor) ||
    sourceAmountMinor < 0
  ) {
    return null;
  }

  return {
    ...money,
    exchangeRate,
    exchangeRateSource,
    exchangeRateTimestamp,
    sourceAmountMinor,
    sourceCurrency,
  };
}

function sanitizeBrand(value: unknown): Brand | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.slug) ||
    !isNonEmptyString(value.name)
  ) {
    return null;
  }

  const aliases = sanitizeStringArray(value.aliases);
  const tags = sanitizeStringArray(value.tags);

  if (aliases === null || tags === null) {
    return null;
  }

  return {
    id: value.id.trim(),
    slug: value.slug.trim(),
    name: value.name.trim(),
    aliases,
    tags,
  };
}

function sanitizeSource(value: unknown): ListingSource | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name)
  ) {
    return null;
  }

  const dataOrigin = value.dataOrigin;
  const isValidDataOrigin =
    dataOrigin === undefined ||
    dataOrigin === "mock" ||
    dataOrigin === "official_api" ||
    dataOrigin === "partner_api" ||
    dataOrigin === "documented_feed" ||
    dataOrigin === "authorized_scraping";
  const isMock = value.isMock;
  const marketplaceId = sanitizeOptionalString(value.marketplaceId);

  if (
    !isValidDataOrigin ||
    (isMock !== undefined && typeof isMock !== "boolean") ||
    marketplaceId === null ||
    (dataOrigin === "mock" && isMock === false) ||
    (isMock === true && dataOrigin !== undefined && dataOrigin !== "mock")
  ) {
    return null;
  }

  return {
    id: value.id.trim(),
    name: value.name.trim(),
    dataOrigin,
    isMock,
    marketplaceId,
  };
}

function sanitizeSeller(value: unknown): ListingSeller | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = sanitizeOptionalString(value.id);
  const username = sanitizeOptionalString(value.username);
  const displayName = sanitizeOptionalString(value.displayName);
  const profileUrl = sanitizeOptionalHttpUrl(value.profileUrl);
  const feedbackScore = value.feedbackScore;
  const feedbackCount = value.feedbackCount;
  const feedbackPercentage = value.feedbackPercentage;
  const trustTier = value.trustTier;

  if (
    id === null ||
    username === null ||
    displayName === null ||
    profileUrl === null ||
    (feedbackScore !== undefined &&
      (typeof feedbackScore !== "number" ||
        !Number.isFinite(feedbackScore) ||
        feedbackScore < 0)) ||
    (feedbackCount !== undefined &&
      (typeof feedbackCount !== "number" ||
        !Number.isSafeInteger(feedbackCount) ||
        feedbackCount < 0)) ||
    (feedbackPercentage !== undefined &&
      (typeof feedbackPercentage !== "number" ||
        !Number.isFinite(feedbackPercentage) ||
        feedbackPercentage < 0 ||
        feedbackPercentage > 100)) ||
    (trustTier !== undefined &&
      trustTier !== "trusted" &&
      trustTier !== "established" &&
      trustTier !== "unverified" &&
      trustTier !== "unknown")
  ) {
    return null;
  }

  let location: ListingSeller["location"];

  if (value.location !== undefined) {
    if (!isRecord(value.location)) {
      return null;
    }

    const city = sanitizeOptionalString(value.location.city);
    const country = sanitizeOptionalString(value.location.country);
    const region = sanitizeOptionalString(value.location.region);

    if (city === null || country === null || region === null) {
      return null;
    }

    location = { city, country, region };
  }

  return {
    id,
    username,
    displayName,
    profileUrl,
    feedbackScore,
    feedbackCount,
    feedbackPercentage,
    location,
    trustTier,
  };
}

function sanitizeMarket(value: unknown): ListingMarketMetrics | null {
  if (
    !isRecord(value) ||
    (value.status !== "active" && value.status !== "sold")
  ) {
    return null;
  }

  const askingPrice = sanitizeOptionalMoney(value.askingPrice);
  const soldPrice = sanitizeOptionalMoney(value.soldPrice);
  const tags = sanitizeStringArray(value.tags);
  const priceDropsCount = value.priceDropsCount;
  const isExcludedFromAnalytics = value.isExcludedFromAnalytics;

  if (
    askingPrice === null ||
    soldPrice === null ||
    tags === null ||
    (priceDropsCount !== undefined &&
      (typeof priceDropsCount !== "number" ||
        !Number.isSafeInteger(priceDropsCount) ||
        priceDropsCount < 0)) ||
    (isExcludedFromAnalytics !== undefined &&
      typeof isExcludedFromAnalytics !== "boolean")
  ) {
    return null;
  }

  return {
    status: value.status,
    askingPrice,
    soldPrice,
    tags,
    priceDropsCount,
    isExcludedFromAnalytics,
  };
}

function sanitizeImages(value: unknown): ListingImage[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const images: ListingImage[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      return null;
    }

    const url = sanitizeHttpUrl(entry.url);
    const alt = sanitizeOptionalString(entry.alt);
    const role = entry.role;
    const width = entry.width;
    const height = entry.height;

    if (
      !url ||
      alt === null ||
      (role !== undefined &&
        role !== "primary" &&
        role !== "alternate" &&
        role !== "thumbnail") ||
      (width !== undefined &&
        (typeof width !== "number" ||
          !Number.isSafeInteger(width) ||
          width <= 0)) ||
      (height !== undefined &&
        (typeof height !== "number" ||
          !Number.isSafeInteger(height) ||
          height <= 0))
    ) {
      return null;
    }

    images.push({ url, alt, role, width, height });
  }

  return images;
}

function sanitizePricing(value: unknown, legacyPrice: Money): ListingPricing | null {
  if (!isRecord(value)) {
    return null;
  }

  const original = sanitizeMoney(value.original);
  const comparison =
    value.comparison === undefined
      ? undefined
      : sanitizeConvertedMoney(value.comparison);
  const display =
    value.display === undefined ? undefined : sanitizeConvertedMoney(value.display);
  const shipping = sanitizeOptionalMoney(value.shipping);
  const landed = sanitizeOptionalMoney(value.landed);

  if (
    !original ||
    comparison === null ||
    display === null ||
    shipping === null ||
    landed === null ||
    original.amount !== legacyPrice.amount ||
    original.currency !== legacyPrice.currency
  ) {
    return null;
  }

  return {
    original,
    comparison,
    display,
    shipping,
    landed,
  };
}

function sanitizeShipping(value: unknown): ListingShipping | null {
  if (!isRecord(value)) {
    return null;
  }

  const cost = sanitizeOptionalMoney(value.cost);
  const destinationCountry = sanitizeOptionalString(value.destinationCountry);
  const originCountry = sanitizeOptionalString(value.originCountry);
  const type = sanitizeOptionalString(value.type);
  const minEstimatedDeliveryAt = sanitizeOptionalTimestamp(
    value.minEstimatedDeliveryAt,
  );
  const maxEstimatedDeliveryAt = sanitizeOptionalTimestamp(
    value.maxEstimatedDeliveryAt,
  );

  if (
    cost === null ||
    destinationCountry === null ||
    originCountry === null ||
    type === null ||
    minEstimatedDeliveryAt === null ||
    maxEstimatedDeliveryAt === null ||
    (value.available !== undefined && typeof value.available !== "boolean") ||
    (value.isFree !== undefined && typeof value.isFree !== "boolean")
  ) {
    return null;
  }

  return {
    available: value.available,
    cost,
    destinationCountry,
    isFree: value.isFree,
    maxEstimatedDeliveryAt,
    minEstimatedDeliveryAt,
    originCountry,
    type,
  };
}

function sanitizeLifecycle(value: unknown): ListingLifecycle | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = value.status;
  const validStatus =
    status === "active" ||
    status === "sold" ||
    status === "stale" ||
    status === "removed" ||
    status === "unavailable" ||
    status === "unknown";
  const observedAt = sanitizeTimestamp(value.observedAt);
  const endedAt = sanitizeOptionalTimestamp(value.endedAt);
  const lastSeenAt = sanitizeOptionalTimestamp(value.lastSeenAt);
  const listedAt = sanitizeOptionalTimestamp(value.listedAt);
  const soldAt = sanitizeOptionalTimestamp(value.soldAt);
  const sourceUpdatedAt = sanitizeOptionalTimestamp(value.sourceUpdatedAt);
  const unavailableAt = sanitizeOptionalTimestamp(value.unavailableAt);

  if (
    !validStatus ||
    !observedAt ||
    endedAt === null ||
    lastSeenAt === null ||
    listedAt === null ||
    soldAt === null ||
    sourceUpdatedAt === null ||
    unavailableAt === null
  ) {
    return null;
  }

  return {
    status,
    observedAt,
    endedAt,
    lastSeenAt,
    listedAt,
    soldAt,
    sourceUpdatedAt,
    unavailableAt,
  };
}

function sanitizeFreshness(value: unknown): ListingFreshness | null {
  if (
    !isRecord(value) ||
    (value.status !== "fresh" &&
      value.status !== "stale" &&
      value.status !== "unknown")
  ) {
    return null;
  }

  const observedAt = sanitizeTimestamp(value.observedAt);
  const sourceUpdatedAt = sanitizeOptionalTimestamp(value.sourceUpdatedAt);
  const staleAt = sanitizeOptionalTimestamp(value.staleAt);

  if (!observedAt || sourceUpdatedAt === null || staleAt === null) {
    return null;
  }

  return {
    status: value.status,
    observedAt,
    sourceUpdatedAt,
    staleAt,
  };
}

function sanitizeAttribution(value: unknown): ListingAttribution | null {
  if (!isRecord(value)) {
    return null;
  }

  const destinationUrl = sanitizeHttpUrl(value.destinationUrl);
  const displayText = sanitizeOptionalString(value.displayText);
  const logoUrl = sanitizeOptionalHttpUrl(value.logoUrl);
  const marketplaceName = sanitizeOptionalString(value.marketplaceName);

  if (
    !destinationUrl ||
    !displayText ||
    logoUrl === null ||
    !marketplaceName ||
    typeof value.required !== "boolean" ||
    (value.affiliate !== undefined && typeof value.affiliate !== "boolean")
  ) {
    return null;
  }

  return {
    affiliate: value.affiliate,
    destinationUrl,
    displayText,
    logoUrl,
    marketplaceName,
    required: value.required,
  };
}

function sanitizeAnalyticsEligibility(
  value: unknown,
): ListingAnalyticsEligibility | null {
  if (!isRecord(value) || typeof value.eligible !== "boolean") {
    return null;
  }

  const exclusionReasons = sanitizeStringArray(value.exclusionReasons);

  if (exclusionReasons === null) {
    return null;
  }

  return {
    eligible: value.eligible,
    exclusionReasons,
  };
}

function isValidListingType(value: unknown): value is Listing["listingType"] {
  return value === "auction" || value === "buy_now" || value === "unknown";
}

function isValidCondition(value: unknown): value is Listing["condition"] {
  return (
    value === undefined ||
    value === "new_with_tags" ||
    value === "new_without_tags" ||
    value === "excellent" ||
    value === "good" ||
    value === "fair" ||
    value === "unknown"
  );
}

export function sanitizeProviderListing(value: unknown): Listing | null {
  if (!isRecord(value)) {
    return null;
  }

  const source = sanitizeSource(value.source);
  const sourceUrl = sanitizeHttpUrl(value.sourceUrl);
  const brand = sanitizeBrand(value.brand);
  const imageUrl = sanitizeHttpUrl(value.imageUrl);
  const price = sanitizeMoney(value.price);
  const fetchedAt = sanitizeTimestamp(value.fetchedAt);
  const category = sanitizeOptionalString(value.category);
  const size = sanitizeOptionalString(value.size);
  const seller =
    value.seller === undefined ? undefined : sanitizeSeller(value.seller);
  const market =
    value.market === undefined ? undefined : sanitizeMarket(value.market);
  const images =
    value.images === undefined ? undefined : sanitizeImages(value.images);
  const pricing =
    value.pricing === undefined || !price
      ? undefined
      : sanitizePricing(value.pricing, price);
  const shipping =
    value.shipping === undefined ? undefined : sanitizeShipping(value.shipping);
  const lifecycle =
    value.lifecycle === undefined
      ? undefined
      : sanitizeLifecycle(value.lifecycle);
  const freshness =
    value.freshness === undefined
      ? undefined
      : sanitizeFreshness(value.freshness);
  const attribution =
    value.attribution === undefined
      ? undefined
      : sanitizeAttribution(value.attribution);
  const analyticsEligibility =
    value.analyticsEligibility === undefined
      ? undefined
      : sanitizeAnalyticsEligibility(value.analyticsEligibility);

  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.providerId) ||
    !isNonEmptyString(value.providerListingId) ||
    !source ||
    !sourceUrl ||
    !isNonEmptyString(value.title) ||
    !brand ||
    !imageUrl ||
    !price ||
    !isValidListingType(value.listingType) ||
    !isValidCondition(value.condition) ||
    !fetchedAt ||
    category === null ||
    size === null ||
    seller === null ||
    market === null ||
    images === null ||
    pricing === null ||
    shipping === null ||
    lifecycle === null ||
    freshness === null ||
    attribution === null ||
    analyticsEligibility === null ||
    (images !== undefined && !images.some((image) => image.url === imageUrl))
  ) {
    return null;
  }

  return {
    id: value.id.trim(),
    providerId: value.providerId.trim(),
    source,
    providerListingId: value.providerListingId.trim(),
    sourceUrl,
    title: value.title.trim(),
    brand,
    imageUrl,
    images,
    price,
    pricing,
    category,
    size,
    condition: value.condition,
    listingType: value.listingType,
    fetchedAt,
    analyticsEligibility,
    attribution,
    freshness,
    lifecycle,
    seller,
    shipping,
    market,
  };
}
