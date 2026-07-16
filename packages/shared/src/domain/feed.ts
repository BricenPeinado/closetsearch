import type { Listing } from "./listing";
import type { PaginationInfo } from "./pagination";
import type { FeedPersonalizationDebug, PersonalizationSummary } from "./recommendation";

export interface FeedQuery {
  cursor?: string;
  debugPersonalization?: boolean;
  page?: number;
  pageSize?: number;
  userId?: string;
}

export interface FeedResponse {
  debugPersonalization?: FeedPersonalizationDebug;
  isPersonalized: boolean;
  listings: Listing[];
  pagination: PaginationInfo;
  personalizationSummary?: PersonalizationSummary;
}
