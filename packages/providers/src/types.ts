import type { Listing, SearchQuery } from "../../shared/src";

export interface Provider {
  id: string;
  name: string;
  search(query: SearchQuery): Promise<Listing[]>;
}
