import type {
  DeleteSavedSearchInput,
  PersistSearchHistoryInput,
} from "@closetsearch/shared";
import {
  clearSavedSearches,
  deleteSavedSearch,
  listSavedSearchesByUserId,
  saveSavedSearch,
} from "./db/repositories/search-history.js";

export function addSavedSearch(input: PersistSearchHistoryInput) {
  return saveSavedSearch(input);
}

export function getSavedSearchesByUserId(userId: string) {
  return listSavedSearchesByUserId(userId);
}

export function removeSavedSearch(input: DeleteSavedSearchInput) {
  return deleteSavedSearch(input);
}

export function resetSavedSearchStore() {
  clearSavedSearches();
}
