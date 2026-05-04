import type { Listing } from "./listing";

export interface FeedQuery {
  page: number;
  pageSize: number;
}

export interface FeedResponse {
  listings: Listing[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  nextPage?: number;
}
