import type { SearchQuery, SearchResult } from "../../shared/src/types";

export interface Provider {
  id: string;
  name: string;
  search(query: SearchQuery): Promise<SearchResult[]>;
}
