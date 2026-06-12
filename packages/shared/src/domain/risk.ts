export const RISK_SIGNAL_CATEGORIES = {
  PRICE_ANOMALY: "price_anomaly",
  MISSING_METADATA: "missing_metadata",
  LOW_IMAGE_QUALITY: "low_image_quality",
  SOURCE_CONFIDENCE: "source_confidence",
  INCONSISTENT_LISTING_INFO: "inconsistent_listing_info",
  UNUSUAL_TITLE_PATTERN: "unusual_title_pattern",
  UNKNOWN: "unknown",
} as const;

export type RiskSignalCategory =
  (typeof RISK_SIGNAL_CATEGORIES)[keyof typeof RISK_SIGNAL_CATEGORIES];

export const RISK_SIGNAL_INPUT_FAMILIES = {
  price: [RISK_SIGNAL_CATEGORIES.PRICE_ANOMALY],
  image: [RISK_SIGNAL_CATEGORIES.LOW_IMAGE_QUALITY],
  metadata: [
    RISK_SIGNAL_CATEGORIES.MISSING_METADATA,
    RISK_SIGNAL_CATEGORIES.UNUSUAL_TITLE_PATTERN,
    RISK_SIGNAL_CATEGORIES.INCONSISTENT_LISTING_INFO,
  ],
  source: [RISK_SIGNAL_CATEGORIES.SOURCE_CONFIDENCE],
} as const;

export type RiskLevel = "low" | "medium" | "elevated" | "unknown";

export interface RiskSignal {
  id: string;
  listingId: string;
  source: string;
  riskLevel: RiskLevel;
  confidence: number;
  categories: RiskSignalCategory[];
  explanation: string;
  disclaimer: string;
  createdAt: string;
}

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low: "Low review signal",
  medium: "Medium review signal",
  elevated: "Elevated review signal",
  unknown: "Limited signal",
};

export const RISK_SIGNAL_LABEL = "Listing signal estimate";

export const RISK_SIGNAL_DISCLAIMER =
  "This is an estimate based on limited listing signals. It is not an authenticity guarantee.";

export const RISK_SIGNAL_PRODUCT_LANGUAGE =
  "Trust signals are assistive, cautious, and never authenticity verdicts.";
