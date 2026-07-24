export const RECOMMENDATION_FEATURE_SCHEMA_VERSION = "recommendation-features/v1";
export const MARKET_FEATURE_SCHEMA_VERSION = "market-fair-value-features/v1";
export const RECOMMENDATION_MODEL_VERSION = "implicit-content-hybrid/v1";
export const FAIR_VALUE_MODEL_VERSION = "ridge-log-price/v1";
export const DEFAULT_ML_SEED = 20_260_724;

export interface FeatureDefinition {
  description: string;
  name: string;
  nullable: boolean;
  type: "categorical" | "integer" | "numeric" | "text" | "timestamp";
}

export const recommendationFeatureSchema = Object.freeze({
  version: RECOMMENDATION_FEATURE_SCHEMA_VERSION,
  itemFeatures: [
    {
      name: "brand",
      type: "categorical",
      nullable: false,
      description: "Canonical brand name.",
    },
    {
      name: "category",
      type: "categorical",
      nullable: false,
      description: "Canonical product category.",
    },
    {
      name: "condition",
      type: "categorical",
      nullable: true,
      description: "Normalized listing condition.",
    },
    {
      name: "size",
      type: "categorical",
      nullable: true,
      description: "Normalized size.",
    },
    {
      name: "source",
      type: "categorical",
      nullable: false,
      description: "Normalized marketplace identifier.",
    },
    {
      name: "title",
      type: "text",
      nullable: false,
      description: "Tokenized normalized listing title.",
    },
    {
      name: "priceMinor",
      type: "integer",
      nullable: false,
      description: "Exact item price in integer minor units.",
    },
    {
      name: "availableAt",
      type: "timestamp",
      nullable: false,
      description: "Timestamp at which the candidate became available.",
    },
  ] satisfies FeatureDefinition[],
  userInputs: [
    "viewport",
    "click",
    "like",
    "save",
    "watchlist",
    "hide",
    "onboarding_preferences",
  ],
});

export const fairValueFeatureSchema = Object.freeze({
  version: MARKET_FEATURE_SCHEMA_VERSION,
  features: [
    {
      name: "canonicalBrand",
      type: "categorical",
      nullable: false,
      description: "Canonical brand name.",
    },
    {
      name: "category",
      type: "categorical",
      nullable: false,
      description: "Canonical product category.",
    },
    {
      name: "condition",
      type: "categorical",
      nullable: true,
      description: "Normalized condition.",
    },
    {
      name: "size",
      type: "categorical",
      nullable: true,
      description: "Normalized size.",
    },
    {
      name: "source",
      type: "categorical",
      nullable: false,
      description: "Marketplace identifier.",
    },
    {
      name: "normalizedCurrency",
      type: "categorical",
      nullable: false,
      description: "Currency after explicit conversion using a recorded rate.",
    },
    {
      name: "title",
      type: "text",
      nullable: false,
      description: "Tokenized title; tokens are learned from training rows only.",
    },
    {
      name: "sourceConfidence",
      type: "numeric",
      nullable: false,
      description: "Calibrated provider/source data confidence.",
    },
    {
      name: "sellerConfidence",
      type: "numeric",
      nullable: false,
      description: "Normalized metadata confidence, not authenticity confidence.",
    },
    {
      name: "shippingKnown",
      type: "categorical",
      nullable: false,
      description: "Whether shipping was provided; shipping amount is not the target.",
    },
  ] satisfies FeatureDefinition[],
  target: {
    name: "soldPriceMinor",
    description:
      "Confirmed sold item price in normalized integer minor units; active asking price is never a target or feature.",
  },
  prohibitedFeatures: ["askingPriceMinor", "futureSoldAt", "futureObservedAt"],
});

export function assertFeatureSchemaVersion(
  actual: string,
  expected: string,
  subject: string,
) {
  if (actual !== expected) {
    throw new Error(
      `${subject} uses feature schema ${actual}; expected ${expected}. Regenerate or migrate the snapshot explicitly.`,
    );
  }
}
