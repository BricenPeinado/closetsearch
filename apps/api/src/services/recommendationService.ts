import type {
  Like,
  Listing,
  OnboardingPreferences,
  User,
} from "@closetsearch/shared";
import { getListingImpressionCount } from "./engagementService.js";
import { getRememberedListing } from "./listingCatalogService.js";

const onboardingBrandMatchWeight = 2.8;
const onboardingCategoryMatchWeight = 1.8;
const likedBrandBoostWeight = 3.4;
const likedCategoryBoostWeight = 2.2;
const repeatedBrandPenaltyWeight = 1.25;
const repeatedCategoryPenaltyWeight = 0.55;
const personalizedCycleSize = 2;
const explorationCycleSize = 1;

interface RecommendationServiceInput {
  listings: Listing[];
  user?: User;
  likes: Like[];
  onboardingPreferences?: OnboardingPreferences;
}

interface PersonalizationSignals {
  onboardingBrands: Set<string>;
  onboardingCategories: Set<string>;
  likedBrands: Set<string>;
  likedCategories: Set<string>;
}

interface ScoreInputs {
  popularityScore: number;
  recencyScore: number;
  brandMatchWeight: number;
  categoryMatchWeight: number;
  likedBrandBoost: number;
  likedCategoryBoost: number;
  repetitionPenalty: number;
}

interface ScoredListing {
  listing: Listing;
  inputs: Omit<ScoreInputs, "repetitionPenalty">;
}

function normalizeToken(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function toSignalSet(values: string[]) {
  return new Set(values.map((value) => normalizeToken(value)).filter(Boolean));
}

function compareListings(left: Listing, right: Listing) {
  const timeDelta =
    new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime();

  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.id.localeCompare(right.id);
}

function sortByNewest(listings: Listing[]) {
  return [...listings].sort(compareListings);
}

function buildPersonalizationSignals(
  likes: Like[],
  onboardingPreferences?: OnboardingPreferences,
) {
  const likedBrands = new Set<string>();
  const likedCategories = new Set<string>();

  for (const like of likes) {
    const likedListing = getRememberedListing(like.listingId);

    if (!likedListing) {
      continue;
    }

    const normalizedBrand = normalizeToken(likedListing.brand.name);
    const normalizedCategory = normalizeToken(likedListing.category);

    if (normalizedBrand) {
      likedBrands.add(normalizedBrand);
    }

    if (normalizedCategory) {
      likedCategories.add(normalizedCategory);
    }
  }

  return {
    onboardingBrands: toSignalSet(onboardingPreferences?.favoriteBrands ?? []),
    onboardingCategories: toSignalSet(onboardingPreferences?.categories ?? []),
    likedBrands,
    likedCategories,
  };
}

export function hasPersonalizationSignals(
  likes: Like[],
  onboardingPreferences?: OnboardingPreferences,
) {
  const signals = buildPersonalizationSignals(likes, onboardingPreferences);

  return (
    signals.onboardingBrands.size > 0 ||
    signals.onboardingCategories.size > 0 ||
    signals.likedBrands.size > 0 ||
    signals.likedCategories.size > 0
  );
}

function getRecencyScore(listing: Listing, newestTimestamp: number) {
  const listingTimestamp = new Date(listing.fetchedAt).getTime();
  const ageInHours = Math.max(0, newestTimestamp - listingTimestamp) / (1000 * 60 * 60);

  return Math.max(0, 3 - ageInHours / 24);
}

function getPopularityScore(listing: Listing) {
  return Math.min(getListingImpressionCount(listing.id) * 0.2, 1.4);
}

function buildStaticScores(listings: Listing[], signals: PersonalizationSignals) {
  const newestTimestamp = listings.reduce((currentNewest, listing) => {
    const listingTimestamp = new Date(listing.fetchedAt).getTime();
    return Math.max(currentNewest, listingTimestamp);
  }, 0);

  return new Map(
    listings.map((listing) => {
      const normalizedBrand = normalizeToken(listing.brand.name);
      const normalizedCategory = normalizeToken(listing.category);

      const scoredListing: ScoredListing = {
        listing,
        inputs: {
          popularityScore: getPopularityScore(listing),
          recencyScore: getRecencyScore(listing, newestTimestamp),
          brandMatchWeight: signals.onboardingBrands.has(normalizedBrand)
            ? onboardingBrandMatchWeight
            : 0,
          categoryMatchWeight: signals.onboardingCategories.has(normalizedCategory)
            ? onboardingCategoryMatchWeight
            : 0,
          likedBrandBoost: signals.likedBrands.has(normalizedBrand)
            ? likedBrandBoostWeight
            : 0,
          likedCategoryBoost: signals.likedCategories.has(normalizedCategory)
            ? likedCategoryBoostWeight
            : 0,
        },
      };

      return [listing.id, scoredListing] as const;
    }),
  );
}

function getRepetitionPenalty(
  listing: Listing,
  brandCounts: Map<string, number>,
  categoryCounts: Map<string, number>,
) {
  const normalizedBrand = normalizeToken(listing.brand.name);
  const normalizedCategory = normalizeToken(listing.category);
  const repeatedBrandCount = normalizedBrand ? (brandCounts.get(normalizedBrand) ?? 0) : 0;
  const repeatedCategoryCount = normalizedCategory
    ? (categoryCounts.get(normalizedCategory) ?? 0)
    : 0;

  return (
    repeatedBrandCount * repeatedBrandPenaltyWeight +
    Math.max(0, repeatedCategoryCount - 1) * repeatedCategoryPenaltyWeight
  );
}

function getTotalScore(
  scoredListing: ScoredListing,
  repetitionPenalty: number,
) {
  const { inputs } = scoredListing;

  return (
    inputs.popularityScore +
    inputs.recencyScore +
    inputs.brandMatchWeight +
    inputs.categoryMatchWeight +
    inputs.likedBrandBoost +
    inputs.likedCategoryBoost -
    repetitionPenalty
  );
}

function incrementCount(counts: Map<string, number>, value?: string) {
  const normalizedValue = normalizeToken(value);

  if (!normalizedValue) {
    return;
  }

  counts.set(normalizedValue, (counts.get(normalizedValue) ?? 0) + 1);
}

function rankWithDiversity(
  listings: Listing[],
  scoredListingsById: Map<string, ScoredListing>,
) {
  const remainingListings = [...listings];
  const rankedListings: Listing[] = [];
  const brandCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  while (remainingListings.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const [index, listing] of remainingListings.entries()) {
      const scoredListing = scoredListingsById.get(listing.id);

      if (!scoredListing) {
        continue;
      }

      const repetitionPenalty = getRepetitionPenalty(
        listing,
        brandCounts,
        categoryCounts,
      );
      const score = getTotalScore(scoredListing, repetitionPenalty);
      const currentBest = remainingListings[bestIndex];

      if (
        score > bestScore ||
        (score === bestScore &&
          currentBest &&
          compareListings(listing, currentBest) < 0)
      ) {
        bestIndex = index;
        bestScore = score;
      }
    }

    const [selectedListing] = remainingListings.splice(bestIndex, 1);

    if (!selectedListing) {
      break;
    }

    rankedListings.push(selectedListing);
    incrementCount(brandCounts, selectedListing.brand.name);
    incrementCount(categoryCounts, selectedListing.category);
  }

  return rankedListings;
}

function mixPersonalizedAndExploration(
  personalizedListings: Listing[],
  explorationListings: Listing[],
) {
  const mixedListings: Listing[] = [];
  const seenListingIds = new Set<string>();
  let personalizedIndex = 0;
  let explorationIndex = 0;

  function takeNext(listings: Listing[], startIndex: number) {
    let nextIndex = startIndex;

    while (nextIndex < listings.length) {
      const listing = listings[nextIndex];
      nextIndex += 1;

      if (!listing || seenListingIds.has(listing.id)) {
        continue;
      }

      seenListingIds.add(listing.id);
      mixedListings.push(listing);

      return nextIndex;
    }

    return nextIndex;
  }

  while (mixedListings.length < personalizedListings.length) {
    const previousLength = mixedListings.length;

    for (let index = 0; index < personalizedCycleSize; index += 1) {
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

export function rankListings({
  listings,
  user,
  likes,
  onboardingPreferences,
}: RecommendationServiceInput) {
  if (!user || listings.length <= 1) {
    return sortByNewest(listings);
  }

  const signals = buildPersonalizationSignals(likes, onboardingPreferences);
  const hasSignals =
    signals.onboardingBrands.size > 0 ||
    signals.onboardingCategories.size > 0 ||
    signals.likedBrands.size > 0 ||
    signals.likedCategories.size > 0;

  if (!hasSignals) {
    return sortByNewest(listings);
  }

  const personalizedScores = buildStaticScores(listings, signals);
  const explorationScores = buildStaticScores(listings, {
    onboardingBrands: new Set<string>(),
    onboardingCategories: new Set<string>(),
    likedBrands: new Set<string>(),
    likedCategories: new Set<string>(),
  });
  const personalizedRankedListings = rankWithDiversity(listings, personalizedScores);
  const explorationRankedListings = rankWithDiversity(listings, explorationScores);

  return mixPersonalizedAndExploration(
    personalizedRankedListings,
    explorationRankedListings,
  );
}
