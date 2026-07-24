import type {
  ListingCondition,
  ListingMarketStatus,
  ListingType,
  SearchHistoryEntry,
  SearchSortMode,
} from "@closetsearch/shared";

export type SearchListingTypeFilter = "" | Exclude<ListingType, "unknown">;
export type SearchConditionFilter = "" | ListingCondition;
export type SearchMarketStatusFilter = "" | ListingMarketStatus;

export interface SearchFormValues {
  brand?: string;
  category?: string;
  condition?: SearchConditionFilter;
  currency?: string;
  query: string;
  sort: SearchSortMode;
  source: string;
  listingType: SearchListingTypeFilter;
  marketStatus?: SearchMarketStatusFilter;
  minPrice: string;
  maxPrice: string;
  size?: string;
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
    brand: "",
    category: "",
    condition: "",
    currency: "",
    sort: "relevance",
    source: "",
    listingType: "",
    marketStatus: "",
    minPrice: "",
    maxPrice: "",
    size: "",
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

function normalizeCondition(value: string | null): SearchConditionFilter {
  switch (value) {
    case "new_with_tags":
    case "new_without_tags":
    case "excellent":
    case "good":
    case "fair":
    case "unknown":
      return value;
    default:
      return "";
  }
}

function normalizeMarketStatus(value: string | null): SearchMarketStatusFilter {
  return value === "active" || value === "sold" ? value : "";
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
    brand: searchParams.get("brands")?.trim() ?? "",
    category: searchParams.get("categories")?.trim() ?? "",
    condition: normalizeCondition(searchParams.get("conditions")),
    currency: searchParams.get("currency")?.trim().toUpperCase() ?? "",
    query: searchParams.get("q")?.trim() ?? "",
    sort: normalizeSearchSortMode(searchParams.get("sort")),
    source: searchParams.get("source")?.trim() ?? "",
    listingType: normalizeListingType(searchParams.get("listingType")),
    marketStatus: normalizeMarketStatus(searchParams.get("marketScope")),
    minPrice: normalizePriceValue(searchParams.get("minPrice")),
    maxPrice: normalizePriceValue(searchParams.get("maxPrice")),
    size: searchParams.get("sizes")?.trim() ?? "",
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
  setOptionalParam(params, "brands", values.brand ?? "");
  setOptionalParam(params, "categories", values.category ?? "");
  setOptionalParam(params, "sizes", values.size ?? "");
  setOptionalParam(params, "conditions", values.condition ?? "");
  setOptionalParam(params, "marketScope", values.marketStatus ?? "");
  setOptionalParam(params, "currency", values.currency ?? "");
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
    (values.brand?.trim().length ?? 0) > 0 ||
    (values.category?.trim().length ?? 0) > 0 ||
    (values.size?.trim().length ?? 0) > 0 ||
    (values.condition?.trim().length ?? 0) > 0 ||
    (values.marketStatus?.trim().length ?? 0) > 0 ||
    (values.currency?.trim().length ?? 0) > 0 ||
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

function formatPriceLabel(minPrice: string, maxPrice: string, currency?: string): string | null {
  const normalizedCurrency = currency?.trim().toUpperCase();
  const prefix = normalizedCurrency ? `${normalizedCurrency} ` : "$";

  if (minPrice && maxPrice) {
    return `${prefix}${minPrice} to ${normalizedCurrency ? "" : "$"}${maxPrice}`;
  }

  if (minPrice) {
    return `${prefix}${minPrice}+`;
  }

  if (maxPrice) {
    return `Up to ${prefix}${maxPrice}`;
  }

  return null;
}

export function describeSearch(values: SearchFormValues): string {
  const details = [
    values.brand || null,
    values.category || null,
    values.size ? `Size ${values.size}` : null,
    values.condition || null,
    values.source || null,
    formatListingTypeLabel(values.listingType),
    values.marketStatus || null,
    formatSortLabel(values.sort),
    formatPriceLabel(values.minPrice, values.maxPrice, values.currency),
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
