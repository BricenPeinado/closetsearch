import type { PersistSearchHistoryInput } from "@closetsearch/shared";
import {
  clearRecentSearches,
  listRecentSearchesByUserId,
  saveRecentSearch,
} from "./db/repositories/search-history.js";

export function addRecentSearch(input: PersistSearchHistoryInput) {
  return saveRecentSearch(input);
}

export function getRecentSearchesByUserId(userId: string) {
  return listRecentSearchesByUserId(userId);
}

export function removeRecentSearchesByUserId(userId: string) {
  clearRecentSearches(userId);
}

export function resetRecentSearchStore() {
  clearRecentSearches();
}
