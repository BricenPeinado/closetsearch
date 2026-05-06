import type { Listing } from "./listing";

export interface FeedQuery {
  page: number;
  pageSize: number;
  userId?: string;
}

export interface FeedResponse {
  listings: Listing[];
  isPersonalized: boolean;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  nextPage?: number;
}
