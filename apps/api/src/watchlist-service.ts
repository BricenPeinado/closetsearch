import type { DeleteWatchlistInput, PersistWatchlistInput } from "@closetsearch/shared";
import {
  clearWatchlists,
  deleteWatchlist,
  insertWatchlist,
  listWatchlistsByUserId,
  mapWatchlistResult,
} from "./db/repositories/watchlists.js";

function normalizeOptionalNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;
}

export function addWatchlist(input: PersistWatchlistInput) {
  const row = insertWatchlist({
    ...input,
    label: input.label.trim(),
    queryText: input.queryText?.trim() || undefined,
    brand: input.brand?.trim() || undefined,
    source: input.source?.trim() || undefined,
    maxPrice: normalizeOptionalNumber(input.maxPrice),
  });

  return mapWatchlistResult(row);
}

export function getWatchlistsByUserId(userId: string) {
  return listWatchlistsByUserId(userId);
}

export function removeWatchlist(input: DeleteWatchlistInput) {
  return deleteWatchlist(input.userId, input.id);
}

export function resetWatchlistStore() {
  clearWatchlists();
}
