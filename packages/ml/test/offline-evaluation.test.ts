import { describe, expect, it } from "vitest";
import {
  evaluateFairValueModel,
  evaluateFairValuePromotion,
  evaluateObservedMedianBaseline,
  evaluateRecommendationModel,
  evaluateRecommendationPromotion,
  getEligibleSoldObservations,
  prepareMarketObservations,
  trainFairValueModel,
  trainRecommendationModel,
  validateMarketSnapshot,
  validateRecommendationSnapshot,
} from "../src/index.js";
import { marketFixture, recommendationFixture } from "./fixtures.js";

describe("offline temporal evaluation", () => {
  it("reports deterministic ranking metrics and blocks fixture promotion", () => {
    const snapshot = recommendationFixture();
    const split = validateRecommendationSnapshot(snapshot);
    const artifact = trainRecommendationModel(snapshot);
    const first = evaluateRecommendationModel({
      artifact,
      evaluationAsOf: "2026-01-12T12:00:00.000Z",
      evaluationEvents: split.test,
      k: 5,
      listings: snapshot.listings,
      preferences: snapshot.preferences,
    });
    const second = evaluateRecommendationModel({
      artifact,
      evaluationAsOf: "2026-01-12T12:00:00.000Z",
      evaluationEvents: split.test,
      k: 5,
      listings: snapshot.listings,
      preferences: snapshot.preferences,
    });
    const promotion = evaluateRecommendationPromotion({
      baseline: first.baseline,
      candidate: first.candidate,
      latencyP95Ms: 2,
      reproducibleSnapshots: 1,
    });

    expect(first).toEqual(second);
    expect(first.candidate.allUsers.evaluatedUsers).toBe(8);
    expect(first.candidate.allUsers.recallAtK).toBeGreaterThanOrEqual(0);
    expect(first.candidate.allUsers.ndcgAtK).toBeGreaterThanOrEqual(0);
    expect(first.candidate.allUsers.mapAtK).toBeGreaterThanOrEqual(0);
    expect(first.candidate.allUsers.catalogCoverage).toBeGreaterThan(0);
    expect(first.candidate.allUsers.intraListDiversity).toBeGreaterThan(0);
    expect(first.candidate.allUsers.novelty).toBeGreaterThan(0);
    expect(promotion.approved).toBe(false);
    expect(promotion.reasons.join(" ")).toContain("evaluated_users");

    console.info("RECOMMENDATION_FIXTURE_EVALUATION", JSON.stringify(first));
  });

  it("reports deterministic temporal and segment market metrics and blocks promotion", () => {
    const snapshot = marketFixture();
    const artifact = trainFairValueModel({ snapshot });
    const split = validateMarketSnapshot(snapshot);
    const prepared = prepareMarketObservations(snapshot);
    const history = getEligibleSoldObservations(prepared).filter(
      (row) => (row.soldAt ?? "") < snapshot.splitBoundaries.validationEndExclusive,
    );
    const first = evaluateFairValueModel(artifact, split.test);
    const second = evaluateFairValueModel(artifact, split.test);
    const baseline = evaluateObservedMedianBaseline(history, split.test);
    const promotion = evaluateFairValuePromotion({
      baseline: baseline.overall,
      candidate: first.overall,
      drifted: false,
      reproducibleSnapshots: 1,
      stale: false,
    });

    expect(first).toEqual(second);
    expect(first.overall.sampleCount).toBe(6);
    expect(first.byBrand).toHaveLength(3);
    expect(first.byCategory).toHaveLength(3);
    expect(first.bySource.length).toBeGreaterThanOrEqual(2);
    expect(first.overall.maeMinor).toBeGreaterThanOrEqual(0);
    expect(first.overall.medianAbsoluteErrorMinor).toBeGreaterThanOrEqual(0);
    expect(first.overall.mapeEligibleCount).toBe(6);
    expect(first.overall.intervalCoverage).toBeGreaterThanOrEqual(0);
    expect(promotion.approved).toBe(false);
    expect(promotion.reasons.join(" ")).toContain("temporal_test_samples");

    console.info(
      "MARKET_FIXTURE_EVALUATION",
      JSON.stringify({ baseline, candidate: first }),
    );
  });
});
