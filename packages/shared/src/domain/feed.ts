import type { Listing } from "./listing.js";
import type { PaginationInfo } from "./pagination.js";
import type {
  FeedPersonalizationDebug,
  FeedRecommendationMetadata,
  PersonalizationSummary,
} from "./recommendation.js";
import type { SearchProviderSummary } from "./search.js";

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
  providers?: SearchProviderSummary[];
  recommendation?: FeedRecommendationMetadata;
}
