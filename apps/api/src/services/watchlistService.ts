import type {
  PersistWatchlistInput,
  UpdateWatchlistInput,
  Watchlist,
  WatchlistInput,
} from "@closetsearch/shared";
import { ApiError } from "../api-error.js";
import {
  clearWatchlists,
  deleteWatchlist,
  findWatchlistByUserIdAndId,
  insertWatchlist,
  listWatchlistsByUserId,
  mapWatchlistResult,
  updateWatchlist as persistWatchlistUpdate,
} from "../db/repositories/watchlists.js";

interface NormalizedWatchlistInput {
  label?: string;
  queryText?: string;
  brand?: string;
  category?: string;
  source?: string;
  listingType?: Watchlist["listingType"];
  minPriceAmount?: number;
  maxPriceAmount?: number;
  priceCurrency?: string;
  condition?: Watchlist["condition"];
  size?: string;
  enabled?: boolean;
}

function normalizeOptionalString(value: string | undefined) {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : undefined;
}

function normalizeOptionalNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : undefined;
}

function normalizeCurrency(value: string | undefined) {
  const normalizedValue = value?.trim().toUpperCase();
  return normalizedValue ? normalizedValue : undefined;
}

function formatSourceLabel(value: string) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function formatTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatPriceForLabel(amount: number, currency = "USD") {
  if (currency === "USD") {
    return `$${amount}`;
  }

  return `${currency} ${amount}`;
}

function buildWatchSubject(input: NormalizedWatchlistInput) {
  const brand = normalizeOptionalString(input.brand);
  const category = normalizeOptionalString(input.category);
  const queryText = normalizeOptionalString(input.queryText);

  if (brand && category) {
    return `${brand} ${category}`;
  }

  if (brand) {
    return brand;
  }

  if (category) {
    return formatTitleCase(category);
  }

  if (queryText) {
    return formatTitleCase(queryText);
  }

  if (input.source && input.listingType) {
    return `${formatSourceLabel(input.source)} ${input.listingType === "auction" ? "auctions" : "fixed price"}`;
  }

  if (input.source) {
    return formatSourceLabel(input.source);
  }

  if (input.listingType) {
    return input.listingType === "auction" ? "Auction listings" : "Fixed price listings";
  }

  if (input.size) {
    return `Size ${input.size}`;
  }

  if (input.condition) {
    return formatTitleCase(input.condition.replace(/_/g, " "));
  }

  return "Watchlist";
}

function hasMeaningfulCriteria(input: NormalizedWatchlistInput) {
  return Boolean(
    input.queryText ||
    input.brand ||
    input.category ||
    input.source ||
    input.listingType ||
    input.minPriceAmount !== undefined ||
    input.maxPriceAmount !== undefined ||
    input.size ||
    input.condition,
  );
}

export function buildWatchlistLabel(input: WatchlistInput) {
  const normalizedInput = normalizeWatchlistInput(input);
  const subject = buildWatchSubject(normalizedInput);

  if (normalizedInput.maxPriceAmount !== undefined) {
    return `${subject} under ${formatPriceForLabel(
      normalizedInput.maxPriceAmount,
      normalizedInput.priceCurrency,
    )}`;
  }

  if (normalizedInput.minPriceAmount !== undefined) {
    return `${subject} from ${formatPriceForLabel(
      normalizedInput.minPriceAmount,
      normalizedInput.priceCurrency,
    )}`;
  }

  if (normalizedInput.queryText && !normalizedInput.brand && !normalizedInput.category) {
    return `${formatTitleCase(normalizedInput.queryText)} search`;
  }

  return subject;
}

function normalizeWatchlistInput(input: WatchlistInput): NormalizedWatchlistInput {
  return {
    label: normalizeOptionalString(input.label),
    queryText: normalizeOptionalString(input.queryText),
    brand: normalizeOptionalString(input.brand),
    category: normalizeOptionalString(input.category),
    source: normalizeOptionalString(input.source),
    listingType: input.listingType,
    minPriceAmount: normalizeOptionalNumber(input.minPriceAmount),
    maxPriceAmount: normalizeOptionalNumber(input.maxPriceAmount),
    priceCurrency: normalizeCurrency(input.priceCurrency),
    condition: input.condition,
    size: normalizeOptionalString(input.size),
    enabled: input.enabled,
  };
}

function validateWatchlistInput(input: NormalizedWatchlistInput) {
  if (!hasMeaningfulCriteria(input)) {
    throw new ApiError(
      400,
      "invalid_request",
      "Add at least one watch criterion like a brand, query, category, source, size, condition, or price range.",
    );
  }

  if (
    input.minPriceAmount !== undefined &&
    input.maxPriceAmount !== undefined &&
    input.maxPriceAmount < input.minPriceAmount
  ) {
    throw new ApiError(400, "invalid_request", "Max price cannot be lower than min price.");
  }

  if (input.priceCurrency && input.priceCurrency.length !== 3) {
    throw new ApiError(400, "invalid_request", "priceCurrency must be a 3-letter currency code.");
  }
}

function mergeWatchlistInput(
  input: { userId: string; id?: string } & WatchlistInput,
  fallback?: Watchlist,
) {
  const normalizedInput = normalizeWatchlistInput(input);

  const mergedInput = {
    userId: input.userId,
    id: input.id,
    label: normalizedInput.label,
    queryText: normalizedInput.queryText ?? fallback?.queryText,
    brand: normalizedInput.brand ?? fallback?.brand,
    category: normalizedInput.category ?? fallback?.category,
    source: normalizedInput.source ?? fallback?.source,
    listingType: normalizedInput.listingType ?? fallback?.listingType,
    minPriceAmount:
      normalizedInput.minPriceAmount !== undefined
        ? normalizedInput.minPriceAmount
        : fallback?.minPriceAmount,
    maxPriceAmount:
      normalizedInput.maxPriceAmount !== undefined
        ? normalizedInput.maxPriceAmount
        : fallback?.maxPriceAmount,
    priceCurrency: normalizedInput.priceCurrency ?? fallback?.priceCurrency,
    condition: normalizedInput.condition ?? fallback?.condition,
    size: normalizedInput.size ?? fallback?.size,
    enabled: normalizedInput.enabled ?? fallback?.enabled ?? true,
  };

  validateWatchlistInput(mergedInput);

  return {
    ...mergedInput,
    label: mergedInput.label || buildWatchlistLabel(mergedInput),
  };
}

export function createWatchlist(input: PersistWatchlistInput) {
  const row = insertWatchlist(mergeWatchlistInput(input));
  return mapWatchlistResult(row);
}

export function getWatchlistsByUserId(userId: string) {
  return listWatchlistsByUserId(userId);
}

export function updateWatchlist(input: UpdateWatchlistInput) {
  const existingWatchlist = findWatchlistByUserIdAndId(input.userId, input.id);

  if (!existingWatchlist) {
    throw new ApiError(404, "watchlist_not_found", "Watchlist not found.");
  }

  const mergedWatchlistInput = mergeWatchlistInput(input, existingWatchlist);
  const row = persistWatchlistUpdate({
    ...mergedWatchlistInput,
    id: input.id,
  });

  if (!row) {
    throw new ApiError(404, "watchlist_not_found", "Watchlist not found.");
  }

  return mapWatchlistResult(row);
}

export function removeWatchlist(input: { id: string; userId: string }) {
  return deleteWatchlist(input.userId, input.id);
}

export function resetWatchlistStore() {
  clearWatchlists();
}
