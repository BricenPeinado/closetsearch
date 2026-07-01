import type { Listing } from "./listing";
import type { PaginationInfo } from "./pagination";

export interface FeedQuery {
  cursor?: string;
  page?: number;
  pageSize?: number;
  userId?: string;
}

export interface FeedResponse {
  listings: Listing[];
  isPersonalized: boolean;
  pagination: PaginationInfo;
}
