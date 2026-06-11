import {
  RISK_SIGNAL_CATEGORIES,
  RISK_SIGNAL_DISCLAIMER,
  type Listing,
  type RiskLevel,
  type RiskSignal,
  type RiskSignalCategory,
} from "@closetsearch/shared";

const RISK_SIGNAL_SOURCE = "placeholder_trust_foundation";

const CATEGORY_LABELS: Record<RiskSignalCategory, string> = {
  [RISK_SIGNAL_CATEGORIES.PRICE_ANOMALY]: "price positioning",
  [RISK_SIGNAL_CATEGORIES.MISSING_METADATA]: "limited listing details",
  [RISK_SIGNAL_CATEGORIES.LOW_IMAGE_QUALITY]: "limited image detail",
  [RISK_SIGNAL_CATEGORIES.SOURCE_CONFIDENCE]: "source completeness",
  [RISK_SIGNAL_CATEGORIES.INCONSISTENT_LISTING_INFO]: "listing consistency",
  [RISK_SIGNAL_CATEGORIES.UNUSUAL_TITLE_PATTERN]: "title wording",
  [RISK_SIGNAL_CATEGORIES.UNKNOWN]: "limited listing detail",
};

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, value));
}

function formatCategoryList(categories: RiskSignalCategory[]) {
  return categories.map((category) => CATEGORY_LABELS[category]).join(", ");
}

function buildExplanation(riskLevel: RiskLevel, categories: RiskSignalCategory[]) {
  switch (riskLevel) {
    case "elevated":
      return "Some listing details are limited, so this item has a higher placeholder review signal.";
    case "medium":
      return `A few listing details suggest this item may deserve a closer manual review, including ${formatCategoryList(categories)}.`;
    case "unknown":
      return "There is not enough listing detail here to form more than a limited placeholder signal.";
    case "low":
    default:
      return "The currently available listing details look fairly complete, so the placeholder review signal is low.";
  }
}

function getMissingMetadataCategories(listing: Listing) {
  const missingMetadataCategories: RiskSignalCategory[] = [];

  if (!listing.brand?.name.trim() || !listing.category?.trim()) {
    missingMetadataCategories.push(RISK_SIGNAL_CATEGORIES.MISSING_METADATA);
  }

  if (!listing.source.id.trim() || !listing.source.name.trim()) {
    missingMetadataCategories.push(RISK_SIGNAL_CATEGORIES.SOURCE_CONFIDENCE);
  }

  return missingMetadataCategories;
}

export function generateRiskSignal(listing: Listing): RiskSignal {
  const categories = new Set<RiskSignalCategory>();
  const normalizedTitle = listing.title.trim();
  const normalizedImageUrl = listing.imageUrl.trim().toLowerCase();
  const missingMetadataCount = [listing.category, listing.size, listing.condition].filter(
    (value) => !value?.trim(),
  ).length;

  for (const category of getMissingMetadataCategories(listing)) {
    categories.add(category);
  }

  if (!normalizedImageUrl || /placeholder|default|fallback|blank/.test(normalizedImageUrl)) {
    categories.add(RISK_SIGNAL_CATEGORIES.LOW_IMAGE_QUALITY);
  }

  if (missingMetadataCount >= 2) {
    categories.add(RISK_SIGNAL_CATEGORIES.MISSING_METADATA);
  }

  if (/!!!|100%\s+authentic|guaranteed\s+real/i.test(normalizedTitle)) {
    categories.add(RISK_SIGNAL_CATEGORIES.UNUSUAL_TITLE_PATTERN);
  }

  if (listing.source.id !== listing.providerId) {
    categories.add(RISK_SIGNAL_CATEGORIES.INCONSISTENT_LISTING_INFO);
  }

  if (listing.price.amount <= 75) {
    categories.add(RISK_SIGNAL_CATEGORIES.PRICE_ANOMALY);
  } else if (listing.price.amount <= 125 && listing.brand.name.trim().length > 0) {
    categories.add(RISK_SIGNAL_CATEGORIES.PRICE_ANOMALY);
  }

  const categoryList = [...categories];
  const hasPriceAnomaly = categoryList.includes(RISK_SIGNAL_CATEGORIES.PRICE_ANOMALY);
  let riskLevel: RiskLevel = "low";

  if (
    listing.price.amount <= 75 ||
    categoryList.length >= 3 ||
    (hasPriceAnomaly && categoryList.includes(RISK_SIGNAL_CATEGORIES.MISSING_METADATA))
  ) {
    riskLevel = "elevated";
  } else if (missingMetadataCount >= 2 && !normalizedImageUrl) {
    riskLevel = "unknown";
  } else if (categoryList.length > 0) {
    riskLevel = "medium";
  }

  const normalizedCategories =
    riskLevel === "unknown" && categoryList.length === 0
      ? [RISK_SIGNAL_CATEGORIES.UNKNOWN]
      : categoryList;

  const confidence = clampConfidence(
    riskLevel === "unknown"
      ? 0.18
      : 0.24 + normalizedCategories.length * 0.14 + (riskLevel === "elevated" ? 0.1 : 0),
  );

  return {
    id: `${listing.id}:risk`,
    listingId: listing.id,
    source: RISK_SIGNAL_SOURCE,
    riskLevel,
    confidence,
    categories: normalizedCategories,
    explanation: buildExplanation(riskLevel, normalizedCategories),
    disclaimer: RISK_SIGNAL_DISCLAIMER,
    createdAt: new Date().toISOString(),
  };
}
