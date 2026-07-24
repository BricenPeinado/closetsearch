import type {
  AlertMatchResult,
  AlertMatchReason,
  Listing,
  PersistAlertMatchInput,
  Watchlist,
} from "@closetsearch/shared";
import {
  clearAlertMatches,
  listAlertMatchesByUserId,
  upsertAlertMatch,
} from "../db/repositories/alert-matches.js";

function normalizeText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      normalizeText(value)
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

function addReason(reasons: AlertMatchReason[], code: string, label: string) {
  reasons.push({ code, label });
}

function matchesExactish(expected: string | undefined, actual: string | undefined) {
  const normalizedExpected = normalizeText(expected);
  const normalizedActual = normalizeText(actual);

  if (!normalizedExpected) {
    return true;
  }

  if (!normalizedActual) {
    return false;
  }

  return (
    normalizedActual === normalizedExpected ||
    normalizedActual.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedActual)
  );
}

function matchesQueryText(queryText: string | undefined, listing: Listing) {
  const normalizedQuery = normalizeText(queryText);

  if (!normalizedQuery) {
    return true;
  }

  const searchableText = normalizeText(
    [listing.title, listing.brand.name, listing.category, listing.source.id, listing.source.name]
      .filter(Boolean)
      .join(" "),
  );

  if (!searchableText) {
    return false;
  }

  if (searchableText.includes(normalizedQuery)) {
    return true;
  }

  const queryTerms = tokenize(normalizedQuery);

  if (queryTerms.length === 0) {
    return false;
  }

  const matchedTermCount = queryTerms.filter((term) => searchableText.includes(term)).length;
  return matchedTermCount >= Math.ceil(queryTerms.length / 2);
}

export function evaluateWatchlistMatch(watchlist: Watchlist, listing: Listing): AlertMatchResult {
  const reasons: AlertMatchReason[] = [];

  if (!watchlist.enabled) {
    return {
      matched: false,
      reasons,
    };
  }

  if (!matchesExactish(watchlist.brand, listing.brand.name)) {
    return { matched: false, reasons: [] };
  }

  if (watchlist.brand) {
    addReason(reasons, "brand_match", "Brand matches watched brand");
  }

  if (!matchesQueryText(watchlist.queryText, listing)) {
    return { matched: false, reasons: [] };
  }

  if (watchlist.queryText) {
    addReason(reasons, "query_match", "Listing matches watched search");
  }

  if (!matchesExactish(watchlist.category, listing.category)) {
    return { matched: false, reasons: [] };
  }

  if (watchlist.category) {
    addReason(reasons, "category_match", "Category matches watched category");
  }

  if (
    watchlist.source &&
    !(
      matchesExactish(watchlist.source, listing.source.id) ||
      matchesExactish(watchlist.source, listing.source.name)
    )
  ) {
    return { matched: false, reasons: [] };
  }

  if (watchlist.source) {
    addReason(reasons, "source_match", "Marketplace matches watched source");
  }

  if (watchlist.listingType && watchlist.listingType !== listing.listingType) {
    return { matched: false, reasons: [] };
  }

  if (watchlist.listingType) {
    addReason(reasons, "listing_type_match", "Listing type matches watched listing type");
  }

  if (
    watchlist.priceCurrency &&
    normalizeText(watchlist.priceCurrency) !== normalizeText(listing.price.currency)
  ) {
    return { matched: false, reasons: [] };
  }

  if (watchlist.priceCurrency) {
    addReason(reasons, "price_currency_match", "Currency matches watched price currency");
  }

  if (
    watchlist.minPriceAmount !== undefined &&
    Number.isFinite(listing.price.amount) &&
    listing.price.amount < watchlist.minPriceAmount
  ) {
    return { matched: false, reasons: [] };
  }

  if (watchlist.minPriceAmount !== undefined) {
    addReason(reasons, "price_over_min", "Price is above watched minimum");
  }

  if (
    watchlist.maxPriceAmount !== undefined &&
    Number.isFinite(listing.price.amount) &&
    listing.price.amount > watchlist.maxPriceAmount
  ) {
    return { matched: false, reasons: [] };
  }

  if (watchlist.maxPriceAmount !== undefined) {
    addReason(reasons, "price_under_max", "Price is under watched maximum");
  }

  if (!matchesExactish(watchlist.size, listing.size)) {
    return { matched: false, reasons: [] };
  }

  if (watchlist.size) {
    addReason(reasons, "size_match", "Size matches watched size");
  }

  if (!matchesExactish(watchlist.condition, listing.condition)) {
    return { matched: false, reasons: [] };
  }

  if (watchlist.condition) {
    addReason(reasons, "condition_match", "Condition matches watched condition");
  }

  return {
    matched: reasons.length > 0,
    reasons,
  };
}

export function getAlertMatchesByUserId(userId: string) {
  return listAlertMatchesByUserId(userId);
}

export function storeAlertMatchCandidate(input: PersistAlertMatchInput) {
  return upsertAlertMatch(input);
}

export function resetAlertMatchStore() {
  clearAlertMatches();
}
