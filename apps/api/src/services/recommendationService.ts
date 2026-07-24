import type {
  FeedPersonalizationDebug,
  Listing,
  PersonalizationSummary,
  RecommendationReason,
  RecommendationScoreBreakdown,
} from "@closetsearch/shared";
import type { PersonalizationProfile } from "./personalizationSignalsService.js";

interface RecommendationServiceInput {
  engagementByListingId?: ReadonlyMap<string, number>;
  includeDebug?: boolean;
  listings: Listing[];
  profile?: PersonalizationProfile;
}

interface RecommendationResult {
  debugPersonalization?: FeedPersonalizationDebug;
  isPersonalized: boolean;
  listings: Listing[];
  personalizationSummary: PersonalizationSummary;
}

interface ScoredListing {
  breakdown: RecommendationScoreBreakdown;
  listing: Listing;
}

const personalizationCycleSize = 3;
const explorationCycleSize = 1;

function normalizeToken(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function roundWeight(value: number) {
  return Number(value.toFixed(3));
}

function compareListings(left: Listing, right: Listing) {
  const timeDelta = new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime();

  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.id.localeCompare(right.id);
}

function sortByNewest(listings: Listing[]) {
  return [...listings].sort(compareListings);
}

function addReason(reasons: RecommendationReason[], code: string, label: string, weight: number) {
  if (Math.abs(weight) < 0.001) {
    return;
  }

  reasons.push({
    code,
    label,
    weight: roundWeight(weight),
  });
}

function dedupeListings(listings: Listing[]) {
  const listingsById = new Map<string, Listing>();

  for (const listing of listings) {
    const existingListing = listingsById.get(listing.id);

    if (!existingListing || compareListings(listing, existingListing) < 0) {
      listingsById.set(listing.id, listing);
    }
  }

  return sortByNewest(Array.from(listingsById.values()));
}

function getNewestTimestamp(listings: Listing[]) {
  return listings.reduce((newestTimestamp, listing) => {
    return Math.max(newestTimestamp, new Date(listing.fetchedAt).getTime());
  }, 0);
}

function getAffinityWeight(signals: Map<string, number>, value: string | undefined, cap: number) {
  const normalizedValue = normalizeToken(value);

  if (!normalizedValue) {
    return 0;
  }

  return Math.min(signals.get(normalizedValue) ?? 0, cap);
}

function getQueryIntentWeight(listing: Listing, queryTermAffinities: Map<string, number>) {
  const searchableText = [listing.brand.name, listing.title, listing.category]
    .map((value) => normalizeToken(value))
    .filter(Boolean)
    .join(" ");
  let weight = 0;

  for (const [term, termWeight] of queryTermAffinities.entries()) {
    if (searchableText.includes(term)) {
      weight += termWeight;
    }
  }

  return Math.min(weight, 2.4);
}

function getFreshnessScore(listing: Listing, newestTimestamp: number) {
  const listingTimestamp = new Date(listing.fetchedAt).getTime();
  const ageInHours = Math.max(0, newestTimestamp - listingTimestamp) / (1000 * 60 * 60);

  if (ageInHours <= 12) {
    return 1.6;
  }

  if (ageInHours <= 48) {
    return 1.15;
  }

  if (ageInHours <= 120) {
    return 0.55;
  }

  if (ageInHours <= 240) {
    return -0.9;
  }

  return -5.1;
}

function getListingQualityScore(listing: Listing) {
  let score = 0;

  if (listing.title.trim().length > 0) {
    score += 0.16;
  }

  if (listing.brand.name.trim().length > 0) {
    score += 0.16;
  }

  if (listing.imageUrl.trim().length > 0) {
    score += 0.18;
  }

  if (listing.sourceUrl.trim().length > 0) {
    score += 0.16;
  }

  if (Number.isFinite(listing.price.amount) && listing.price.amount > 0) {
    score += 0.14;
  }

  if (listing.category?.trim()) {
    score += 0.08;
  }

  if (listing.size?.trim()) {
    score += 0.06;
  }

  if (listing.condition && listing.condition !== "unknown") {
    score += 0.06;
  }

  return score - 0.4;
}

function getEngagementScore(listing: Listing, engagementByListingId?: ReadonlyMap<string, number>) {
  return Math.min((engagementByListingId?.get(listing.id) ?? 0) * 0.08, 0.45);
}

function getPriceAffinityScore(listing: Listing, profile: PersonalizationProfile) {
  const price =
    listing.pricing?.display ??
    listing.pricing?.comparison ??
    listing.pricing?.original ??
    listing.price;
  const currency = price.currency.trim().toUpperCase();

  if (profile.pricePreferences.length === 0 || price.amount <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    return 0;
  }

  let bestScore = 0;

  for (const range of profile.pricePreferences) {
    if (range.currency !== currency) {
      continue;
    }

    if (range.min !== undefined && price.amount < range.min) {
      const gapRatio = (range.min - price.amount) / Math.max(range.min, 1);
      bestScore = Math.max(bestScore, gapRatio <= 0.2 ? range.weight * 0.5 : 0);
      continue;
    }

    if (range.max !== undefined && price.amount > range.max) {
      const gapRatio = (price.amount - range.max) / Math.max(range.max, 1);
      bestScore = Math.max(bestScore, gapRatio <= 0.2 ? range.weight * 0.45 : 0);
      continue;
    }

    bestScore = Math.max(bestScore, range.weight);
  }

  return Math.min(bestScore, 1.25);
}

function createGenericBreakdown(
  listing: Listing,
  newestTimestamp: number,
  engagementByListingId?: ReadonlyMap<string, number>,
) {
  const reasons: RecommendationReason[] = [];
  const freshnessScore = getFreshnessScore(listing, newestTimestamp);
  const qualityScore = getListingQualityScore(listing);
  const engagementScore = getEngagementScore(listing, engagementByListingId);

  addReason(
    reasons,
    freshnessScore >= 0 ? "freshness" : "stale_penalty",
    freshnessScore >= 0 ? "Newer listing" : "Older listing",
    freshnessScore,
  );
  addReason(
    reasons,
    qualityScore >= 0 ? "listing_quality" : "listing_quality_penalty",
    qualityScore >= 0 ? "Complete listing data" : "Incomplete listing data",
    qualityScore,
  );
  addReason(reasons, "engagement", "Recent shopper engagement", engagementScore);

  return {
    listingId: listing.id,
    reasons,
    totalScore: roundWeight(reasons.reduce((sum, reason) => sum + reason.weight, 0)),
  } satisfies RecommendationScoreBreakdown;
}

function createPersonalizedBreakdown(
  listing: Listing,
  newestTimestamp: number,
  profile: PersonalizationProfile,
  engagementByListingId?: ReadonlyMap<string, number>,
) {
  const reasons: RecommendationReason[] = [];

  const brandAffinity = getAffinityWeight(profile.brandAffinities, listing.brand.name, 5.5);
  const categoryAffinity = getAffinityWeight(profile.categoryAffinities, listing.category, 4.4);
  const sizeSimilarity = getAffinityWeight(profile.sizeAffinities, listing.size, 1.25);
  const conditionSimilarity = getAffinityWeight(
    profile.conditionAffinities,
    listing.condition,
    1.15,
  );
  const sourcePreference = getAffinityWeight(profile.sourceAffinities, listing.source.id, 2.4);
  const listingTypeAffinity = getAffinityWeight(
    profile.listingTypeAffinities,
    listing.listingType,
    1.2,
  );
  const queryIntent = getQueryIntentWeight(listing, profile.queryTermAffinities);
  const priceAffinity = getPriceAffinityScore(listing, profile);
  const freshnessScore = getFreshnessScore(listing, newestTimestamp);
  const qualityScore = getListingQualityScore(listing);
  const engagementScore = getEngagementScore(listing, engagementByListingId);

  addReason(reasons, "brand_affinity", "Matches your brand preferences", brandAffinity);
  addReason(reasons, "category_affinity", "Matches your category preferences", categoryAffinity);
  addReason(reasons, "source_preference", "Matches your preferred sources", sourcePreference);
  addReason(reasons, "price_affinity", "Fits your usual price range", priceAffinity);
  addReason(reasons, "query_intent", "Matches saved query terms", queryIntent);
  addReason(reasons, "size_similarity", "Matches sizes from liked items", sizeSimilarity);
  addReason(
    reasons,
    "condition_similarity",
    "Matches conditions from liked items",
    conditionSimilarity,
  );
  addReason(
    reasons,
    "listing_type_affinity",
    "Matches your listing type preferences",
    listingTypeAffinity,
  );
  addReason(
    reasons,
    freshnessScore >= 0 ? "freshness" : "stale_penalty",
    freshnessScore >= 0 ? "Newer listing" : "Older listing",
    freshnessScore,
  );
  addReason(
    reasons,
    qualityScore >= 0 ? "listing_quality" : "listing_quality_penalty",
    qualityScore >= 0 ? "Complete listing data" : "Incomplete listing data",
    qualityScore,
  );
  addReason(reasons, "engagement", "Recent shopper engagement", engagementScore);

  return {
    listingId: listing.id,
    reasons,
    totalScore: roundWeight(reasons.reduce((sum, reason) => sum + reason.weight, 0)),
  } satisfies RecommendationScoreBreakdown;
}

function listingSignature(listing: Listing) {
  const price =
    listing.pricing?.display ??
    listing.pricing?.comparison ??
    listing.pricing?.original ??
    listing.price;

  return [
    normalizeToken(listing.brand.name),
    normalizeToken(listing.category),
    normalizeToken(listing.size),
    price.currency.trim().toUpperCase(),
    Math.round(price.amount / 25),
  ].join("|");
}

function buildDynamicPenaltyReasons(
  listing: Listing,
  brandCounts: Map<string, number>,
  categoryCounts: Map<string, number>,
  sourceCounts: Map<string, number>,
  seenSignatures: Map<string, number>,
) {
  const reasons: RecommendationReason[] = [];
  const normalizedBrand = normalizeToken(listing.brand.name);
  const normalizedCategory = normalizeToken(listing.category);
  const normalizedSource = normalizeToken(listing.source.id);
  const signature = listingSignature(listing);
  const brandCount = normalizedBrand ? (brandCounts.get(normalizedBrand) ?? 0) : 0;
  const categoryCount = normalizedCategory ? (categoryCounts.get(normalizedCategory) ?? 0) : 0;
  const sourceCount = normalizedSource ? (sourceCounts.get(normalizedSource) ?? 0) : 0;
  const signatureCount = seenSignatures.get(signature) ?? 0;

  if (brandCount > 0) {
    addReason(
      reasons,
      "brand_repetition_penalty",
      "Reduced repeated brands near the top",
      -0.95 * brandCount,
    );
  }

  if (categoryCount > 1) {
    addReason(
      reasons,
      "category_repetition_penalty",
      "Reduced repeated categories near the top",
      -0.45 * (categoryCount - 1),
    );
  }

  if (sourceCount > 1) {
    addReason(
      reasons,
      "source_repetition_penalty",
      "Reduced repeated sources near the top",
      -0.35 * (sourceCount - 1),
    );
  }

  if (signatureCount > 0) {
    addReason(
      reasons,
      "near_duplicate_penalty",
      "Reduced near-identical listings",
      -1.1 * signatureCount,
    );
  }

  return reasons;
}

function mergeBreakdowns(
  baseBreakdown: RecommendationScoreBreakdown,
  dynamicReasons: RecommendationReason[],
) {
  const reasons = [...baseBreakdown.reasons, ...dynamicReasons];

  return {
    listingId: baseBreakdown.listingId,
    reasons,
    totalScore: roundWeight(reasons.reduce((sum, reason) => sum + reason.weight, 0)),
  } satisfies RecommendationScoreBreakdown;
}

function selectWithDiversity(candidates: ScoredListing[]) {
  const remaining = [...candidates];
  const selected: ScoredListing[] = [];
  const brandCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const seenSignatures = new Map<string, number>();

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestBreakdown = remaining[0]?.breakdown;

    for (const [index, candidate] of remaining.entries()) {
      const dynamicReasons = buildDynamicPenaltyReasons(
        candidate.listing,
        brandCounts,
        categoryCounts,
        sourceCounts,
        seenSignatures,
      );
      const mergedBreakdown = mergeBreakdowns(candidate.breakdown, dynamicReasons);
      const currentBestListing = remaining[bestIndex]?.listing;

      if (
        mergedBreakdown.totalScore > bestScore ||
        (mergedBreakdown.totalScore === bestScore &&
          currentBestListing &&
          compareListings(candidate.listing, currentBestListing) < 0)
      ) {
        bestIndex = index;
        bestScore = mergedBreakdown.totalScore;
        bestBreakdown = mergedBreakdown;
      }
    }

    const [selectedCandidate] = remaining.splice(bestIndex, 1);

    if (!selectedCandidate || !bestBreakdown) {
      break;
    }

    selected.push({
      listing: selectedCandidate.listing,
      breakdown: bestBreakdown,
    });

    const normalizedBrand = normalizeToken(selectedCandidate.listing.brand.name);
    const normalizedCategory = normalizeToken(selectedCandidate.listing.category);
    const normalizedSource = normalizeToken(selectedCandidate.listing.source.id);
    const signature = listingSignature(selectedCandidate.listing);

    if (normalizedBrand) {
      brandCounts.set(normalizedBrand, (brandCounts.get(normalizedBrand) ?? 0) + 1);
    }

    if (normalizedCategory) {
      categoryCounts.set(normalizedCategory, (categoryCounts.get(normalizedCategory) ?? 0) + 1);
    }

    if (normalizedSource) {
      sourceCounts.set(normalizedSource, (sourceCounts.get(normalizedSource) ?? 0) + 1);
    }

    seenSignatures.set(signature, (seenSignatures.get(signature) ?? 0) + 1);
  }

  return selected;
}

function interleavePersonalizedAndExploration(
  personalizedListings: ScoredListing[],
  explorationListings: ScoredListing[],
) {
  const mixedListings: ScoredListing[] = [];
  const seenListingIds = new Set<string>();
  let personalizedIndex = 0;
  let explorationIndex = 0;

  function takeNext(candidates: ScoredListing[], startIndex: number) {
    let nextIndex = startIndex;

    while (nextIndex < candidates.length) {
      const candidate = candidates[nextIndex];
      nextIndex += 1;

      if (!candidate || seenListingIds.has(candidate.listing.id)) {
        continue;
      }

      seenListingIds.add(candidate.listing.id);
      mixedListings.push(candidate);
      return nextIndex;
    }

    return nextIndex;
  }

  while (mixedListings.length < personalizedListings.length) {
    const previousLength = mixedListings.length;

    for (let index = 0; index < personalizationCycleSize; index += 1) {
      personalizedIndex = takeNext(personalizedListings, personalizedIndex);
    }

    for (let index = 0; index < explorationCycleSize; index += 1) {
      explorationIndex = takeNext(explorationListings, explorationIndex);
    }

    if (mixedListings.length === previousLength) {
      break;
    }
  }

  return mixedListings;
}

function toSummary(profile?: PersonalizationProfile): PersonalizationSummary {
  if (!profile) {
    return {
      isPersonalized: false,
      message: "Popular finds across resale marketplaces.",
      signalCount: 0,
      signalLabels: [],
    };
  }

  return {
    isPersonalized: profile.isPersonalized,
    message: profile.summaryMessage,
    signalCount: profile.signalCount,
    signalLabels: profile.signalLabels,
  };
}

export function rankListings({
  engagementByListingId,
  includeDebug = false,
  listings,
  profile,
}: RecommendationServiceInput): RecommendationResult {
  const uniqueListings = dedupeListings(listings);
  const personalizationSummary = toSummary(profile);

  if (!profile?.isPersonalized) {
    const fallbackListings = sortByNewest(uniqueListings);

    return {
      debugPersonalization: includeDebug
        ? {
            scoreBreakdowns: [],
          }
        : undefined,
      isPersonalized: false,
      listings: fallbackListings,
      personalizationSummary,
    };
  }

  const newestTimestamp = getNewestTimestamp(uniqueListings);
  const personalizedCandidates = uniqueListings.map((listing) => ({
    listing,
    breakdown: createPersonalizedBreakdown(
      listing,
      newestTimestamp,
      profile,
      engagementByListingId,
    ),
  }));
  const explorationCandidates = uniqueListings.map((listing) => ({
    listing,
    breakdown: createGenericBreakdown(listing, newestTimestamp, engagementByListingId),
  }));

  const personalizedRanked = selectWithDiversity(personalizedCandidates);
  const explorationRanked = selectWithDiversity(explorationCandidates);
  const mixedRankedListings = interleavePersonalizedAndExploration(
    personalizedRanked,
    explorationRanked,
  );

  return {
    debugPersonalization: includeDebug
      ? {
          scoreBreakdowns: mixedRankedListings.map((candidate) => candidate.breakdown),
        }
      : undefined,
    isPersonalized: true,
    listings: mixedRankedListings.map((candidate) => candidate.listing),
    personalizationSummary,
  };
}
