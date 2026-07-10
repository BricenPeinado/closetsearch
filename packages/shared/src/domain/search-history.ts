export interface SearchHistoryEntry {
  id: string;
  label: string;
  description: string;
  params: string;
  createdAt: string;
}

export interface PersistedSearchHistoryEntry extends SearchHistoryEntry {
  userId: string;
}

export type RecentSearch = PersistedSearchHistoryEntry;
export type SavedSearch = PersistedSearchHistoryEntry;

export interface PersistSearchHistoryInput {
  userId: string;
  label: string;
  description: string;
  params: string;
}

export interface DeleteSavedSearchInput {
  userId: string;
  id?: string;
  params?: string;
}
