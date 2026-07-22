import type { ListingType, SearchHistoryEntry, SearchSortMode } from "@closetsearch/shared";

export type SearchListingTypeFilter = "" | Exclude<ListingType, "unknown">;

export interface SearchFormValues {
  query: string;
  sort: SearchSortMode;
  source: string;
  listingType: SearchListingTypeFilter;
  minPrice: string;
  maxPrice: string;
}

export type RecentSearchEntry = SearchHistoryEntry;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RECENT_SEARCHES_STORAGE_KEY = "closetsearch.recent-searches";
const RECENT_SEARCH_LIMIT = 8;

export function createDefaultSearchFormValues(): SearchFormValues {
  return {
    query: "",
    sort: "relevance",
    source: "",
    listingType: "",
    minPrice: "",
    maxPrice: "",
  };
}

function normalizeSearchSortMode(value: string | null): SearchSortMode {
  switch (value) {
    case "price_asc":
    case "price_desc":
    case "newest":
    case "relevance":
      return value;
    default:
      return "relevance";
  }
}

function normalizeListingType(value: string | null): SearchListingTypeFilter {
  if (value === "fixed_price") {
    return "buy_now";
  }

  if (value === "auction" || value === "buy_now") {
    return value;
  }

  return "";
}

function normalizePriceValue(value: string | null): string {
  if (!value) {
    return "";
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return "";
  }

  return String(parsedValue);
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseSearchFormValues(searchParams: URLSearchParams): SearchFormValues {
  return {
    query: searchParams.get("q")?.trim() ?? "",
    sort: normalizeSearchSortMode(searchParams.get("sort")),
    source: searchParams.get("source")?.trim() ?? "",
    listingType: normalizeListingType(searchParams.get("listingType")),
    minPrice: normalizePriceValue(searchParams.get("minPrice")),
    maxPrice: normalizePriceValue(searchParams.get("maxPrice")),
  };
}

function setOptionalParam(params: URLSearchParams, key: string, value: string) {
  const trimmedValue = value.trim();

  if (trimmedValue.length > 0) {
    params.set(key, trimmedValue);
  }
}

export function createSearchParams(values: SearchFormValues): URLSearchParams {
  const params = new URLSearchParams();
  const query = values.query.trim();

  if (query.length > 0) {
    params.set("q", query);
  }

  if (values.sort !== "relevance") {
    params.set("sort", values.sort);
  }

  setOptionalParam(params, "source", values.source);
  setOptionalParam(params, "listingType", values.listingType);
  setOptionalParam(params, "minPrice", normalizePriceValue(values.minPrice));
  setOptionalParam(params, "maxPrice", normalizePriceValue(values.maxPrice));

  return params;
}

export function hasActiveSearchValues(values: SearchFormValues): boolean {
  return (
    values.query.trim().length > 0 ||
    values.sort !== "relevance" ||
    values.source.trim().length > 0 ||
    values.listingType.trim().length > 0 ||
    normalizePriceValue(values.minPrice).length > 0 ||
    normalizePriceValue(values.maxPrice).length > 0
  );
}

export function buildSearchPath(values: SearchFormValues): string {
  if (!hasActiveSearchValues(values)) {
    return "/search";
  }

  const params = createSearchParams(values);
  const search = params.toString();

  return search.length > 0 ? `/search?${search}` : "/search";
}

function formatListingTypeLabel(listingType: SearchListingTypeFilter): string | null {
  if (listingType === "auction") {
    return "Auction";
  }

  if (listingType === "buy_now") {
    return "Fixed price";
  }

  return null;
}

function formatSortLabel(sort: SearchSortMode): string | null {
  switch (sort) {
    case "price_asc":
      return "Price low to high";
    case "price_desc":
      return "Price high to low";
    case "newest":
      return "Newest first";
    case "relevance":
    default:
      return null;
  }
}

function formatPriceLabel(minPrice: string, maxPrice: string): string | null {
  if (minPrice && maxPrice) {
    return `$${minPrice} to $${maxPrice}`;
  }

  if (minPrice) {
    return `$${minPrice}+`;
  }

  if (maxPrice) {
    return `Up to $${maxPrice}`;
  }

  return null;
}

export function describeSearch(values: SearchFormValues): string {
  const details = [
    values.source || null,
    formatListingTypeLabel(values.listingType),
    formatSortLabel(values.sort),
    formatPriceLabel(values.minPrice, values.maxPrice),
  ].filter((detail): detail is string => detail !== null && detail.length > 0);

  return details.length > 0 ? details.join(" • ") : "Keyword search";
}

export function createRecentSearchEntry(values: SearchFormValues): RecentSearchEntry | null {
  const query = values.query.trim();

  if (query.length === 0) {
    return null;
  }

  const params = createSearchParams(values).toString();

  return {
    id: params,
    label: query,
    description: describeSearch(values),
    params,
    createdAt: new Date().toISOString(),
  };
}

export function mergeRecentSearchEntries(
  entries: RecentSearchEntry[],
  entry: RecentSearchEntry,
): RecentSearchEntry[] {
  return [entry, ...entries.filter((currentEntry) => currentEntry.params !== entry.params)].slice(
    0,
    RECENT_SEARCH_LIMIT,
  );
}

function isRecentSearchEntry(value: unknown): value is RecentSearchEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.params === "string" &&
    typeof candidate.createdAt === "string"
  );
}

export function loadRecentSearches(storage = getBrowserStorage()): RecentSearchEntry[] {
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(RECENT_SEARCHES_STORAGE_KEY);

    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue) as unknown;

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter(isRecentSearchEntry).slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

export function saveRecentSearch(
  values: SearchFormValues,
  storage = getBrowserStorage(),
): RecentSearchEntry[] {
  const entry = createRecentSearchEntry(values);

  if (!entry) {
    return loadRecentSearches(storage);
  }

  const nextEntries = mergeRecentSearchEntries(loadRecentSearches(storage), entry);

  storage?.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(nextEntries));

  return nextEntries;
}

export function clearRecentSearches(storage = getBrowserStorage()) {
  storage?.removeItem(RECENT_SEARCHES_STORAGE_KEY);
}
