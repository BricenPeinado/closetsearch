import type { FeedRecommendationMetadata, Listing } from "@closetsearch/shared";

const dismissedStorageKey = "closetsearch.dismissed-recommendations.v1";
const maximumDismissedListings = 500;

function reasonFromCode(code: string, listing: Listing) {
  const normalized = code.trim().toLowerCase().replaceAll("-", "_");
  const brand = listing.brand.name.trim();

  if (
    normalized.includes("similar") ||
    normalized.includes("like") ||
    normalized.includes("brand_affinity")
  ) {
    return brand ? `Because you liked similar ${brand} pieces` : "Because you liked similar pieces";
  }
  if (normalized.includes("saved_search") || normalized.includes("watchlist")) {
    return "Matches a search or watchlist you saved";
  }
  if (normalized.includes("size") || normalized.includes("category_fit")) {
    return "Matches your saved size and category preferences";
  }
  if (normalized.includes("price")) {
    return "Fits the price range you usually explore";
  }
  if (normalized.includes("new") || normalized.includes("fresh")) {
    return brand ? `New from ${brand}` : "Recently listed";
  }
  if (
    normalized.includes("explor") ||
    normalized.includes("divers") ||
    normalized.includes("novel")
  ) {
    return "A fresh marketplace pick to broaden your feed";
  }
  if (normalized.includes("popular") || normalized.includes("trend")) {
    return "Popular with ClosetSearch shoppers right now";
  }

  return undefined;
}

export function recommendationReasonForListing(
  metadata: FeedRecommendationMetadata | undefined,
  listing: Listing,
  personalized: boolean,
) {
  const rankedItem = metadata?.rankedItems.find((item) => item.listingId === listing.id);
  for (const code of rankedItem?.reasonCodes ?? []) {
    const reason = reasonFromCode(code, listing);
    if (reason) {
      return reason;
    }
  }

  if (personalized) {
    return listing.brand.name.trim()
      ? `Recommended from your interests in ${listing.brand.name}`
      : "Recommended from your recent ClosetSearch activity";
  }

  return "A fresh, marketplace-diverse discovery";
}

export function loadDismissedRecommendationIds() {
  if (typeof window === "undefined") {
    return new Set<string>();
  }

  try {
    const value = JSON.parse(window.localStorage.getItem(dismissedStorageKey) ?? "[]") as unknown;
    return new Set(
      Array.isArray(value)
        ? value
            .filter((item): item is string => typeof item === "string")
            .slice(-maximumDismissedListings)
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

export function persistDismissedRecommendationId(listingId: string) {
  const dismissed = loadDismissedRecommendationIds();
  dismissed.delete(listingId);
  dismissed.add(listingId);

  try {
    window.localStorage.setItem(
      dismissedStorageKey,
      JSON.stringify(Array.from(dismissed).slice(-maximumDismissedListings)),
    );
  } catch {
    // Dismissal still applies to the current React state when storage is restricted.
  }

  return dismissed;
}
