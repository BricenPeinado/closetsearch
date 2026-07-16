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
