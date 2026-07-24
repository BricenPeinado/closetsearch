import type {
  LikedListing,
  OnboardingPreferences,
  SavedFilter,
  SavedSearch,
  User,
  UserSettings,
  Watchlist,
} from "@closetsearch/shared";

interface PricePreferenceRange {
  currency: string;
  max?: number;
  min?: number;
  source: string;
  weight: number;
}

export interface PersonalizationProfile {
  brandAffinities: Map<string, number>;
  categoryAffinities: Map<string, number>;
  conditionAffinities: Map<string, number>;
  isPersonalized: boolean;
  listingTypeAffinities: Map<string, number>;
  pricePreferences: PricePreferenceRange[];
  queryTermAffinities: Map<string, number>;
  signalCount: number;
  signalLabels: string[];
  sizeAffinities: Map<string, number>;
  sourceAffinities: Map<string, number>;
  summaryMessage: string;
}

interface BuildPersonalizationProfileInput {
  likedListings: LikedListing[];
  savedFilters: SavedFilter[];
  savedSearches: SavedSearch[];
  settings?: UserSettings;
  user: User;
  watchlists: Watchlist[];
}

const queryStopWords = new Set([
  "and",
  "for",
  "from",
  "mens",
  "shop",
  "the",
  "vintage",
  "with",
  "women",
  "womens",
]);

function normalizeToken(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function addWeightedSignal(
  signals: Map<string, number>,
  value: string | undefined,
  weight: number,
) {
  const normalizedValue = normalizeToken(value);

  if (!normalizedValue || weight === 0) {
    return;
  }

  signals.set(normalizedValue, Number((signals.get(normalizedValue) ?? 0) + weight));
}

function addQueryTerms(signals: Map<string, number>, value: string | undefined, weight: number) {
  if (!value) {
    return;
  }

  const uniqueTerms = new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3 && !queryStopWords.has(term)),
  );

  for (const term of uniqueTerms) {
    addWeightedSignal(signals, term, weight);
  }
}

function parseDelimitedValues(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumericValue(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? Math.max(0, Math.trunc(parsedValue)) : undefined;
}

function parseOnboardingPriceRange(priceRange: string | undefined) {
  if (!priceRange) {
    return undefined;
  }

  const matches = priceRange.match(/\d[\d,]*/g) ?? [];
  const values = matches
    .map((match) => Number(match.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));

  if (values.length >= 2) {
    const [firstValue, secondValue] = values;
    return {
      min: Math.min(firstValue, secondValue),
      max: Math.max(firstValue, secondValue),
    };
  }

  if (values.length === 1) {
    const [value] = values;
    const normalizedRange = priceRange.toLowerCase();

    if (
      normalizedRange.includes("under") ||
      normalizedRange.includes("below") ||
      normalizedRange.includes("max")
    ) {
      return {
        max: value,
      };
    }

    if (
      normalizedRange.includes("over") ||
      normalizedRange.includes("above") ||
      normalizedRange.includes("from") ||
      normalizedRange.includes("min")
    ) {
      return {
        min: value,
      };
    }
  }

  return undefined;
}

function addPricePreference(
  ranges: PricePreferenceRange[],
  source: string,
  weight: number,
  currency?: string,
  min?: number,
  max?: number,
) {
  const normalizedCurrency = currency?.trim().toUpperCase();

  if (
    !normalizedCurrency ||
    !/^[A-Z]{3}$/.test(normalizedCurrency) ||
    (min === undefined && max === undefined)
  ) {
    return;
  }

  ranges.push({
    currency: normalizedCurrency,
    source,
    weight,
    min,
    max,
  });
}

function buildSignalLabels(input: BuildPersonalizationProfileInput) {
  const labels: string[] = [];

  if (input.likedListings.length > 0) {
    labels.push("likes");
  }

  if (
    input.user.onboardingPreferences.favoriteBrands.length > 0 ||
    input.user.onboardingPreferences.categories.length > 0 ||
    input.user.onboardingPreferences.priceRange.trim().length > 0
  ) {
    labels.push("onboarding preferences");
  }

  if (input.savedSearches.length > 0) {
    labels.push("saved searches");
  }

  if (input.savedFilters.length > 0) {
    labels.push("saved filters");
  }

  if (input.watchlists.length > 0) {
    labels.push("watchlists");
  }

  if ((input.settings?.preferredSources.length ?? 0) > 0) {
    labels.push("preferred sources");
  }

  return labels;
}

function buildSummaryMessage(signalLabels: string[]) {
  if (signalLabels.length === 0) {
    return "Like listings or save a search to personalize this feed.";
  }

  if (signalLabels.includes("likes") && signalLabels.includes("saved searches")) {
    return "Personalized from your likes, saved searches, and preferences.";
  }

  if (signalLabels.includes("likes")) {
    return "Personalized from your likes and preferences.";
  }

  if (signalLabels.includes("saved searches") || signalLabels.includes("saved filters")) {
    return "Personalized from your saved searches and filters.";
  }

  return "Personalized from your preferences and recent activity.";
}

function addOnboardingSignals(
  brandAffinities: Map<string, number>,
  categoryAffinities: Map<string, number>,
  pricePreferences: PricePreferenceRange[],
  preferences: OnboardingPreferences,
  currency: string,
) {
  for (const brand of preferences.favoriteBrands) {
    addWeightedSignal(brandAffinities, brand, 2.6);
  }

  for (const category of preferences.categories) {
    addWeightedSignal(categoryAffinities, category, 1.9);
  }

  const onboardingPriceRange = parseOnboardingPriceRange(preferences.priceRange);

  if (onboardingPriceRange) {
    addPricePreference(
      pricePreferences,
      "onboarding",
      0.95,
      currency,
      onboardingPriceRange.min,
      onboardingPriceRange.max,
    );
  }
}

function addLikedListingSignals(
  brandAffinities: Map<string, number>,
  categoryAffinities: Map<string, number>,
  conditionAffinities: Map<string, number>,
  listingTypeAffinities: Map<string, number>,
  pricePreferences: PricePreferenceRange[],
  sizeAffinities: Map<string, number>,
  sourceAffinities: Map<string, number>,
  likedListings: LikedListing[],
) {
  const likedPricesByCurrency = new Map<string, number[]>();

  for (const likedListing of likedListings) {
    const listing = likedListing.listing;

    addWeightedSignal(brandAffinities, listing.brand.name, 3.4);
    addWeightedSignal(categoryAffinities, listing.category, 2.3);
    addWeightedSignal(sizeAffinities, listing.size, 0.8);
    addWeightedSignal(conditionAffinities, listing.condition, 0.65);
    addWeightedSignal(sourceAffinities, listing.source.id, 0.55);
    addWeightedSignal(listingTypeAffinities, listing.listingType, 0.5);

    const price =
      listing.pricing?.display ??
      listing.pricing?.comparison ??
      listing.pricing?.original ??
      listing.price;
    const currency = price.currency.trim().toUpperCase();

    if (/^[A-Z]{3}$/.test(currency) && Number.isFinite(price.amount) && price.amount > 0) {
      const prices = likedPricesByCurrency.get(currency) ?? [];
      prices.push(price.amount);
      likedPricesByCurrency.set(currency, prices);
    }
  }

  for (const [currency, likedPrices] of likedPricesByCurrency.entries()) {
    const averagePrice = likedPrices.reduce((sum, value) => sum + value, 0) / likedPrices.length;
    const min = Math.max(0, Math.round(averagePrice * 0.7));
    const max = Math.max(min, Math.round(averagePrice * 1.3));
    addPricePreference(pricePreferences, "likes", 0.4, currency, min, max);
  }
}

function addSavedSearchSignals(
  brandAffinities: Map<string, number>,
  categoryAffinities: Map<string, number>,
  listingTypeAffinities: Map<string, number>,
  pricePreferences: PricePreferenceRange[],
  queryTermAffinities: Map<string, number>,
  sizeAffinities: Map<string, number>,
  sourceAffinities: Map<string, number>,
  savedSearches: SavedSearch[],
) {
  for (const savedSearch of savedSearches) {
    const searchParams = new URLSearchParams(savedSearch.params);

    addQueryTerms(queryTermAffinities, searchParams.get("q") ?? undefined, 1.05);

    for (const brand of parseDelimitedValues(searchParams.get("brands"))) {
      addWeightedSignal(brandAffinities, brand, 1.85);
    }

    for (const category of parseDelimitedValues(searchParams.get("categories"))) {
      addWeightedSignal(categoryAffinities, category, 1.35);
    }

    for (const size of parseDelimitedValues(searchParams.get("sizes"))) {
      addWeightedSignal(sizeAffinities, size, 0.55);
    }

    for (const source of parseDelimitedValues(
      searchParams.get("source") ?? searchParams.get("sources"),
    )) {
      addWeightedSignal(sourceAffinities, source, 0.8);
    }

    for (const listingType of parseDelimitedValues(
      searchParams.get("listingType") ?? searchParams.get("listingTypes"),
    )) {
      addWeightedSignal(listingTypeAffinities, listingType, 0.7);
    }

    addPricePreference(
      pricePreferences,
      "saved-search",
      0.75,
      searchParams.get("currency") ?? undefined,
      parseNumericValue(searchParams.get("minPrice")),
      parseNumericValue(searchParams.get("maxPrice")),
    );
  }
}

function addSavedFilterSignals(
  listingTypeAffinities: Map<string, number>,
  pricePreferences: PricePreferenceRange[],
  queryTermAffinities: Map<string, number>,
  sourceAffinities: Map<string, number>,
  savedFilters: SavedFilter[],
) {
  for (const savedFilter of savedFilters) {
    addQueryTerms(queryTermAffinities, savedFilter.queryText, 0.95);
    addWeightedSignal(sourceAffinities, savedFilter.source, 1.15);
    addWeightedSignal(listingTypeAffinities, savedFilter.listingType, 0.85);
    addPricePreference(
      pricePreferences,
      "saved-filter",
      0.9,
      undefined,
      savedFilter.minPrice,
      savedFilter.maxPrice,
    );
  }
}

function addWatchlistSignals(
  brandAffinities: Map<string, number>,
  categoryAffinities: Map<string, number>,
  conditionAffinities: Map<string, number>,
  listingTypeAffinities: Map<string, number>,
  pricePreferences: PricePreferenceRange[],
  queryTermAffinities: Map<string, number>,
  sizeAffinities: Map<string, number>,
  sourceAffinities: Map<string, number>,
  watchlists: Watchlist[],
) {
  for (const watchlist of watchlists) {
    addWeightedSignal(brandAffinities, watchlist.brand, 1.1);
    addWeightedSignal(categoryAffinities, watchlist.category, 0.85);
    addWeightedSignal(conditionAffinities, watchlist.condition, 0.45);
    addWeightedSignal(listingTypeAffinities, watchlist.listingType, 0.55);
    addQueryTerms(queryTermAffinities, watchlist.queryText, 0.75);
    addWeightedSignal(sizeAffinities, watchlist.size, 0.4);
    addWeightedSignal(sourceAffinities, watchlist.source, 0.55);
    addPricePreference(
      pricePreferences,
      "watchlist",
      0.55,
      watchlist.priceCurrency,
      watchlist.minPriceAmount,
      watchlist.maxPriceAmount,
    );
  }
}

function addSettingsSignals(sourceAffinities: Map<string, number>, settings?: UserSettings) {
  for (const source of settings?.preferredSources ?? []) {
    addWeightedSignal(sourceAffinities, source, 1.45);
  }
}

export function buildPersonalizationProfile(
  input: BuildPersonalizationProfileInput,
): PersonalizationProfile {
  const brandAffinities = new Map<string, number>();
  const categoryAffinities = new Map<string, number>();
  const conditionAffinities = new Map<string, number>();
  const listingTypeAffinities = new Map<string, number>();
  const pricePreferences: PricePreferenceRange[] = [];
  const queryTermAffinities = new Map<string, number>();
  const sizeAffinities = new Map<string, number>();
  const sourceAffinities = new Map<string, number>();
  const signalLabels = buildSignalLabels(input);

  addOnboardingSignals(
    brandAffinities,
    categoryAffinities,
    pricePreferences,
    input.user.onboardingPreferences,
    input.user.currencyPreference,
  );
  addLikedListingSignals(
    brandAffinities,
    categoryAffinities,
    conditionAffinities,
    listingTypeAffinities,
    pricePreferences,
    sizeAffinities,
    sourceAffinities,
    input.likedListings,
  );
  addSavedSearchSignals(
    brandAffinities,
    categoryAffinities,
    listingTypeAffinities,
    pricePreferences,
    queryTermAffinities,
    sizeAffinities,
    sourceAffinities,
    input.savedSearches,
  );
  addSavedFilterSignals(
    listingTypeAffinities,
    pricePreferences,
    queryTermAffinities,
    sourceAffinities,
    input.savedFilters,
  );
  addWatchlistSignals(
    brandAffinities,
    categoryAffinities,
    conditionAffinities,
    listingTypeAffinities,
    pricePreferences,
    queryTermAffinities,
    sizeAffinities,
    sourceAffinities,
    input.watchlists,
  );
  addSettingsSignals(sourceAffinities, input.settings);

  return {
    brandAffinities,
    categoryAffinities,
    conditionAffinities,
    isPersonalized: signalLabels.length > 0,
    listingTypeAffinities,
    pricePreferences,
    queryTermAffinities,
    signalCount: signalLabels.length,
    signalLabels,
    sizeAffinities,
    sourceAffinities,
    summaryMessage: buildSummaryMessage(signalLabels),
  };
}
