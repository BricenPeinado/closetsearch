import { describe, expect, it } from "vitest";
import {
  FAIR_VALUE_MODEL_VERSION,
  RECOMMENDATION_MODEL_VERSION,
  fitRobustOutlierPolicy,
  getEligibleSoldObservations,
  isRobustPriceOutlier,
  prepareMarketObservations,
  trainFairValueModel,
  trainRecommendationModel,
  validateMarketSnapshot,
  validateRecommendationSnapshot,
} from "../src/index.js";
import { marketFixture, recommendationFixture } from "./fixtures.js";

describe("deterministic training smoke", () => {
  it("validates versioned fixture snapshots and temporal partitions", () => {
    const recommendationSplit = validateRecommendationSnapshot(
      recommendationFixture(),
    );
    const marketSplit = validateMarketSnapshot(marketFixture());

    expect(recommendationSplit.train.length).toBeGreaterThan(0);
    expect(recommendationSplit.validation.length).toBeGreaterThan(0);
    expect(recommendationSplit.test.length).toBeGreaterThan(0);
    expect(marketSplit.train.length).toBeGreaterThan(0);
    expect(marketSplit.validation.length).toBeGreaterThan(0);
    expect(marketSplit.test.length).toBeGreaterThan(0);
  });

  it("produces byte-equivalent recommendation artifacts for the same seed", () => {
    const first = trainRecommendationModel(recommendationFixture());
    const second = trainRecommendationModel(recommendationFixture());

    expect(first).toEqual(second);
    expect(first.metadata.modelVersion).toBe(RECOMMENDATION_MODEL_VERSION);
    expect(first.metadata.status).toBe("shadow");
    expect(first.metadata.dataFingerprint).toMatch(/^[a-f0-9]{8}$/);
  });

  it("deduplicates market rows and removes robust sold-price outliers", () => {
    const snapshot = marketFixture();
    const prepared = prepareMarketObservations(snapshot);
    const eligibleSold = getEligibleSoldObservations(prepared);
    const trainingRows = eligibleSold.filter(
      (row) => (row.soldAt ?? "") < snapshot.splitBoundaries.trainEndExclusive,
    );
    const policy = fitRobustOutlierPolicy(trainingRows);

    expect(prepared.length).toBe(snapshot.observations.length - 1);
    expect(
      isRobustPriceOutlier(
        trainingRows.find((row) => row.observationId === "r-outlier")!,
        policy,
      ),
    ).toBe(true);
  });

  it("produces deterministic fair-value artifacts without asking-price leakage", () => {
    const snapshot = marketFixture();
    const changedAskingPrices = marketFixture();

    for (const observation of changedAskingPrices.observations) {
      if (observation.askingPriceMinor !== undefined) {
        observation.askingPriceMinor += 5_000_000;
      }
    }

    const first = trainFairValueModel({ snapshot });
    const second = trainFairValueModel({ snapshot: changedAskingPrices });

    expect(first).toEqual(second);
    expect(first.metadata.modelVersion).toBe(FAIR_VALUE_MODEL_VERSION);
    expect(first.metadata.status).toBe("shadow");
    expect(first.featureNames).not.toContain("askingPriceMinor");
    expect(first.calibrationSampleCount).toBe(6);
  });
});
