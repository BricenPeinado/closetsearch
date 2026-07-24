import { describe, expect, it } from "vitest";
import {
  rankPopularityFreshnessBaseline,
  rankRecommendations,
  recommendWithFallback,
  trainRecommendationModel,
} from "../src/index.js";
import { recommendationFixture } from "./fixtures.js";

describe("hybrid recommendation and runtime fallback", () => {
  it("uses implicit feedback plus content and returns reason metadata", () => {
    const snapshot = recommendationFixture();
    const artifact = trainRecommendationModel(snapshot);
    const ranking = rankRecommendations({
      artifact,
      asOf: "2026-01-12T12:00:00.000Z",
      candidates: snapshot.listings,
      preference: snapshot.preferences.find(
        (preference) => preference.userId === "u1",
      ),
      topK: 6,
      userId: "u1",
    });

    expect(ranking.slice(0, 2).map((item) => item.listingId)).toContain("l03");
    expect(
      ranking.find((item) => item.listingId === "l03")?.reasons.map((reason) => reason.code),
    ).toContain(
      "content_affinity",
    );
    expect(ranking.every((item, index) => item.rank === index + 1)).toBe(true);
  });

  it("uses a content preference fallback for users without interactions", () => {
    const snapshot = recommendationFixture();
    const artifact = trainRecommendationModel(snapshot);
    const ranking = rankRecommendations({
      artifact,
      asOf: "2026-01-12T12:00:00.000Z",
      candidates: snapshot.listings,
      preference: snapshot.preferences.find(
        (preference) => preference.userId === "u7",
      ),
      topK: 4,
      userId: "u7",
    });

    expect(ranking[0]?.brand).toBe("Rick Owens");
    expect(ranking[0]?.reasons.map((reason) => reason.code)).toContain(
      "cold_start",
    );
    expect(ranking[0]?.reasons.map((reason) => reason.code)).toContain(
      "preference_affinity",
    );
  });

  it("limits brand and source concentration when alternatives exist", () => {
    const snapshot = recommendationFixture();
    const artifact = trainRecommendationModel(snapshot);
    const ranking = rankRecommendations({
      artifact,
      asOf: "2026-01-12T12:00:00.000Z",
      candidates: snapshot.listings,
      diversity: {
        maxBrandShare: 0.34,
        maxSourceShare: 0.45,
      },
      topK: 9,
      userId: "u7",
    });
    const brandCounts = new Map<string, number>();
    const sourceCounts = new Map<string, number>();

    for (const item of ranking) {
      brandCounts.set(item.brand, (brandCounts.get(item.brand) ?? 0) + 1);
      sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
    }

    expect(Math.max(...brandCounts.values())).toBeLessThanOrEqual(4);
    expect(Math.max(...sourceCounts.values())).toBeLessThanOrEqual(5);
  });

  it("keeps the rules baseline active in shadow mode", () => {
    const snapshot = recommendationFixture();
    const artifact = trainRecommendationModel(snapshot);
    const baselineRanker = (candidates: typeof snapshot.listings, topK: number) =>
      rankPopularityFreshnessBaseline(
        artifact,
        candidates,
        "u1",
        "2026-01-12T12:00:00.000Z",
        topK,
      );
    const result = recommendWithFallback({
      artifact,
      asOf: "2026-01-12T12:00:00.000Z",
      baselineRanker,
      candidates: snapshot.listings,
      rolloutMode: "shadow",
      topK: 5,
      userId: "u1",
    });

    expect(result.usedModel).toBe(false);
    expect(result.ranking).toEqual(baselineRanker(snapshot.listings, 5));
    expect(result.shadowRanking).toHaveLength(5);
    expect(result.modelVersion).toBe(artifact.metadata.modelVersion);
  });

  it("falls back on timeout and refuses unpromoted active models", () => {
    const snapshot = recommendationFixture();
    const artifact = trainRecommendationModel(snapshot);
    const baselineRanker = (candidates: typeof snapshot.listings, topK: number) =>
      candidates.slice(0, topK).map((listing) => listing.listingId);
    let clockValue = 0;
    const timedOut = recommendWithFallback({
      artifact,
      asOf: "2026-01-12T12:00:00.000Z",
      baselineRanker,
      candidates: snapshot.listings,
      clock: () => {
        clockValue += 100;
        return clockValue;
      },
      modelPromotionApproved: true,
      rolloutMode: "active",
      timeoutMs: 1,
      topK: 5,
      userId: "u1",
    });
    const notPromoted = recommendWithFallback({
      artifact,
      asOf: "2026-01-12T12:00:00.000Z",
      baselineRanker,
      candidates: snapshot.listings,
      rolloutMode: "active",
      topK: 5,
      userId: "u1",
    });

    expect(timedOut.fallbackReason).toBe("inference_timeout");
    expect(timedOut.usedModel).toBe(false);
    expect(notPromoted.fallbackReason).toBe("model_not_promoted");
    expect(notPromoted.usedModel).toBe(false);
  });
});
