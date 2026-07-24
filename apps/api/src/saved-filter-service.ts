import type { DeleteSavedFilterInput, PersistSavedFilterInput } from "@closetsearch/shared";
import {
  clearSavedFilters,
  deleteSavedFilter,
  listSavedFiltersByUserId,
  mapSavedFilterResult,
  saveSavedFilter,
} from "./db/repositories/saved-filters.js";

function normalizeOptionalNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : undefined;
}

export function addSavedFilter(input: PersistSavedFilterInput) {
  const row = saveSavedFilter({
    ...input,
    label: input.label.trim(),
    queryText: input.queryText?.trim() || undefined,
    source: input.source?.trim() || undefined,
    minPrice: normalizeOptionalNumber(input.minPrice),
    maxPrice: normalizeOptionalNumber(input.maxPrice),
  });

  return mapSavedFilterResult(row);
}

export function getSavedFiltersByUserId(userId: string) {
  return listSavedFiltersByUserId(userId);
}

export function removeSavedFilter(input: DeleteSavedFilterInput) {
  return deleteSavedFilter(input.userId, input.id);
}

export function resetSavedFilterStore() {
  clearSavedFilters();
}
