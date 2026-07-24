export type ModelLifecycleStatus = "candidate" | "shadow" | "promoted" | "retired";

export interface ArtifactMetadata {
  artifactId: string;
  dataFingerprint: string;
  featureSchemaVersion: string;
  modelKind: "recommendation" | "fair_value";
  modelVersion: string;
  seed: number;
  snapshotId: string;
  status: ModelLifecycleStatus;
  trainedAt: string;
  trainingWindowEnd: string;
}

export interface SnapshotMetadata {
  createdAt: string;
  featureSchemaVersion: string;
  isSynthetic: boolean;
  seed: number;
  snapshotId: string;
  source: "recorded_fixture" | "production_snapshot";
}

export interface TemporalBoundaries {
  trainEndExclusive: string;
  validationEndExclusive: string;
}

export interface TemporalSplit<T> {
  test: T[];
  train: T[];
  validation: T[];
}

export type RecommendationEventType =
  | "viewport"
  | "click"
  | "like"
  | "save"
  | "watchlist"
  | "hide";

export interface RecommendationEvent {
  eventId: string;
  eventType: RecommendationEventType;
  listingId: string;
  occurredAt: string;
  userId: string;
}

export interface RecommendationListing {
  availableAt: string;
  brand: string;
  category: string;
  condition?: string;
  currency: string;
  listingId: string;
  marketStatus: "active" | "sold" | "stale" | "unavailable";
  priceMinor: number;
  size?: string;
  source: string;
  title: string;
}

export interface RecommendationPreference {
  favoriteBrands?: string[];
  favoriteCategories?: string[];
  maxPriceMinor?: number;
  minPriceMinor?: number;
  preferredConditions?: string[];
  preferredSizes?: string[];
  preferredSources?: string[];
  queryTerms?: string[];
  userId: string;
}

export interface RecommendationSnapshot {
  events: RecommendationEvent[];
  listings: RecommendationListing[];
  metadata: SnapshotMetadata;
  preferences: RecommendationPreference[];
  splitBoundaries: TemporalBoundaries;
}

export interface RecommendationUserProfile {
  engagedListingWeights: Record<string, number>;
  featureWeights: Record<string, number>;
  positiveWeight: number;
}

export interface RecommendationArtifact {
  itemCooccurrence: Record<string, Record<string, number>>;
  itemPopularity: Record<string, number>;
  metadata: ArtifactMetadata;
  trainingListingIds: string[];
  userProfiles: Record<string, RecommendationUserProfile>;
}

export interface RecommendationReason {
  code:
    | "content_affinity"
    | "implicit_affinity"
    | "preference_affinity"
    | "popularity"
    | "freshness"
    | "brand_diversity"
    | "source_diversity"
    | "cold_start";
  contribution: number;
}

export interface RankedRecommendation {
  brand: string;
  listingId: string;
  rank: number;
  reasons: RecommendationReason[];
  score: number;
  source: string;
}

export interface DiversityConfig {
  brandPenalty: number;
  maxBrandShare: number;
  maxSourceShare: number;
  sourcePenalty: number;
}

export interface RecommendationMetrics {
  brandConcentration: number;
  catalogCoverage: number;
  evaluatedUsers: number;
  intraListDiversity: number;
  mapAtK: number;
  ndcgAtK: number;
  novelty: number;
  providerConcentration: number;
  recallAtK: number;
}

export interface RecommendationEvaluation {
  allUsers: RecommendationMetrics;
  coldStartUsers: RecommendationMetrics;
  k: number;
}

export interface PromotionCheck {
  actual: number;
  name: string;
  passed: boolean;
  required: string;
}

export interface PromotionDecision {
  approved: boolean;
  checks: PromotionCheck[];
  reasons: string[];
}

export type RecommendationRolloutMode = "disabled" | "shadow" | "active";

export interface RecommendationRuntimeResult {
  fallbackReason?:
    | "feature_flag_disabled"
    | "model_not_promoted"
    | "inference_timeout"
    | "inference_error";
  modelVersion?: string;
  ranking: string[];
  rolloutMode: RecommendationRolloutMode;
  shadowRanking?: string[];
  usedModel: boolean;
}

export interface ExchangeRateReference {
  rateId: string;
  source: string;
  timestamp: string;
}

export type MarketObservationStatus = "active" | "sold" | "stale" | "unavailable";

export interface MarketObservation {
  askingPriceMinor?: number;
  canonicalBrand: string;
  category: string;
  condition?: string;
  currency: string;
  deduplicationKey: string;
  exclusionReasons: string[];
  listedAt: string;
  listingId: string;
  normalizedCurrency: string;
  observationId: string;
  observedAt: string;
  originalCurrency: string;
  sellerConfidence: number;
  shippingMinor?: number;
  size?: string;
  soldAt?: string;
  soldPriceMinor?: number;
  source: string;
  sourceConfidence: number;
  status: MarketObservationStatus;
  title: string;
  exchangeRate?: ExchangeRateReference;
}

export interface MarketSnapshot {
  metadata: SnapshotMetadata;
  observations: MarketObservation[];
  splitBoundaries: TemporalBoundaries;
}

export interface RobustSegmentStatistics {
  lowerFenceMinor: number;
  medianMinor: number;
  sampleCount: number;
  upperFenceMinor: number;
}

export interface RobustOutlierPolicy {
  global: RobustSegmentStatistics;
  minSegmentSamples: number;
  segmentKeyVersion: "brand-category-currency/v1";
  segments: Record<string, RobustSegmentStatistics>;
}

export interface MarketTrainingProfile {
  brandDistribution: Record<string, number>;
  categoryDistribution: Record<string, number>;
  sourceDistribution: Record<string, number>;
}

export interface FairValueArtifact {
  calibrationCoverage: number;
  calibrationSampleCount: number;
  coefficients: number[];
  featureNames: string[];
  globalIntervalHalfWidthMinor: number;
  metadata: ArtifactMetadata;
  outlierPolicy: RobustOutlierPolicy;
  ridgeLambda: number;
  segmentIntervalHalfWidths: Record<string, number>;
  trainingProfile: MarketTrainingProfile;
  validationWindowEnd: string;
}

export interface FairValuePrediction {
  confidence: "low" | "medium" | "high";
  currency: string;
  highMinor: number;
  lowMinor: number;
  modelVersion: string;
  pointMinor: number;
}

export interface MarketEvaluationMetrics {
  intervalCoverage: number;
  maeMinor: number;
  mapeEligibleCount: number;
  mapePercent?: number;
  medianAbsoluteErrorMinor: number;
  sampleCount: number;
}

export interface MarketSegmentEvaluation {
  metrics: MarketEvaluationMetrics;
  segment: string;
}

export interface MarketEvaluation {
  byBrand: MarketSegmentEvaluation[];
  byCategory: MarketSegmentEvaluation[];
  bySource: MarketSegmentEvaluation[];
  overall: MarketEvaluationMetrics;
}

export interface DriftReport {
  drifted: boolean;
  maxDistributionDistance: number;
  reasons: string[];
  stale: boolean;
  unseenCategoricalRate: number;
}

export interface ComparableListing {
  observation: MarketObservation;
  similarity: number;
}

export interface ObservedRange {
  comparableCount: number;
  currency: string;
  highMinor: number;
  lowMinor: number;
  medianMinor: number;
}

export interface MarketEstimate {
  comparableCount: number;
  currency: string;
  dataFreshnessAt?: string;
  disclaimer: string;
  estimate?: FairValuePrediction;
  modelVersion?: string;
  observedRange?: ObservedRange;
  reasonCodes: string[];
  status: "model_estimate" | "observed_range" | "limited_data";
  wording: "Estimated range" | "Based on observed comparable listings" | "Limited data";
}
