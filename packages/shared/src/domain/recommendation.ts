export interface RecommendationReason {
  code: string;
  label: string;
  weight: number;
}

export interface RecommendationScoreBreakdown {
  listingId: string;
  totalScore: number;
  reasons: RecommendationReason[];
}

export interface PersonalizationSummary {
  isPersonalized: boolean;
  message: string;
  signalCount: number;
  signalLabels: string[];
}

export interface FeedPersonalizationDebug {
  scoreBreakdowns: RecommendationScoreBreakdown[];
}

export type RecommendationRolloutMode = "disabled" | "shadow" | "active";

export type RecommendationRankingStrategy = "rules" | "ml_hybrid";

export type RecommendationFallbackReason =
  | "artifact_invalid"
  | "artifact_unavailable"
  | "feature_flag_disabled"
  | "feature_schema_mismatch"
  | "inference_error"
  | "inference_timeout"
  | "model_not_promoted"
  | "model_stale"
  | "model_version_mismatch"
  | "no_eligible_candidates";

/**
 * Non-sensitive explanation metadata for a single ranked listing.
 *
 * The API deliberately returns reason codes rather than model feature values or
 * user-profile weights.
 */
export interface RankedRecommendationMetadata {
  listingId: string;
  rank: number;
  reasonCodes: string[];
}

export interface RecommendationShadowMetadata {
  comparedAtK: number;
  overlapAtK: number;
  rankedItems: RankedRecommendationMetadata[];
}

export interface FeedRecommendationMetadata {
  artifactId?: string;
  fallbackReason?: RecommendationFallbackReason;
  featureSchemaVersion?: string;
  modelVersion?: string;
  rankedItems: RankedRecommendationMetadata[];
  rolloutMode: RecommendationRolloutMode;
  shadow?: RecommendationShadowMetadata;
  strategy: RecommendationRankingStrategy;
  usedModel: boolean;
}
