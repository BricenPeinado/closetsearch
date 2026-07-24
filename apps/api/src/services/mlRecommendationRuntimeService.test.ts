import type { Listing } from "@closetsearch/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { resetMetrics } from "../metrics.js";
import {
  MlRecommendationRuntime,
  RECOMMENDATION_RUNTIME_FEATURE_SCHEMA_VERSION,
  RECOMMENDATION_RUNTIME_MODEL_VERSION,
  readRecommendationRuntimeConfig,
  type RecommendationRuntimeArtifact,
  type RecommendationRuntimeConfig,
} from "./mlRecommendationRuntimeService.js";
import { rankListings } from "./recommendationService.js";

const now = Date.parse("2026-07-24T12:00:00.000Z");

function createListing(
  id: string,
  options: {
    brand?: string;
    currency?: string;
    fetchedAt?: string;
    source?: string;
    status?: "active" | "sold" | "stale";
  } = {},
): Listing {
  const brand = options.brand ?? "Kapital";
  const source = options.source ?? "grailed";
  const status = options.status ?? "active";

  return {
    brand: {
      id: `brand:${brand.toLowerCase().replaceAll(" ", "-")}`,
      name: brand,
      slug: brand.toLowerCase().replaceAll(" ", "-"),
    },
    category: "outerwear",
    condition: "good",
    fetchedAt: options.fetchedAt ?? "2026-07-24T10:00:00.000Z",
    id,
    imageUrl: `https://images.example/${id}.jpg`,
    lifecycle: {
      observedAt: "2026-07-24T10:00:00.000Z",
      status,
    },
    listingType: "buy_now",
    price: {
      amount: 250,
      amountMinor: 25_000,
      currency: options.currency ?? "USD",
      fractionDigits: 2,
    },
    providerId: source,
    providerListingId: id,
    size: "M",
    source: {
      id: source,
      name: source,
    },
    sourceUrl: `https://${source}.example/listings/${id}`,
    title: `${brand} field jacket`,
  };
}

function createArtifact(
  overrides: {
    featureSchemaVersion?: string;
    modelVersion?: string;
    status?: "candidate" | "shadow" | "promoted" | "retired";
    trainedAt?: string;
  } = {},
): RecommendationRuntimeArtifact {
  return {
    itemCooccurrence: {},
    itemPopularity: {
      a1: 8,
      a2: 7,
      a3: 6,
      a4: 5,
      b1: 4,
      c1: 3,
    },
    metadata: {
      artifactId: "recommendation-production-snapshot-1",
      dataFingerprint: "1234abcd",
      featureSchemaVersion:
        overrides.featureSchemaVersion ?? RECOMMENDATION_RUNTIME_FEATURE_SCHEMA_VERSION,
      modelKind: "recommendation",
      modelVersion: overrides.modelVersion ?? RECOMMENDATION_RUNTIME_MODEL_VERSION,
      seed: 20_260_724,
      snapshotId: "production-snapshot-1",
      status: overrides.status ?? "promoted",
      trainedAt: overrides.trainedAt ?? "2026-07-20T00:00:00.000Z",
      trainingWindowEnd: "2026-07-19T00:00:00.000Z",
    },
    trainingListingIds: ["training-1"],
    userProfiles: {
      "user-1": {
        engagedListingWeights: {},
        featureWeights: {
          "brand:kapital": 12,
          "category:outerwear": 4,
        },
        positiveWeight: 8,
      },
    },
  };
}

function createConfig(
  overrides: Partial<RecommendationRuntimeConfig> = {},
): RecommendationRuntimeConfig {
  return {
    maximumArtifactAgeDays: 45,
    mode: "active",
    promotionApproved: true,
    timeoutMs: 25,
    ...overrides,
  };
}

function candidateSet() {
  return [
    createListing("a1", { brand: "Kapital", source: "grailed" }),
    createListing("a2", { brand: "Kapital", source: "grailed" }),
    createListing("a3", { brand: "Kapital", source: "grailed" }),
    createListing("a4", { brand: "Kapital", source: "grailed" }),
    createListing("b1", { brand: "Visvim", source: "ebay" }),
    createListing("c1", { brand: "Auralee", source: "ebay" }),
  ];
}

describe("ML recommendation runtime", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("defaults invalid or absent rollout configuration to fail-closed disabled mode", () => {
    expect(readRecommendationRuntimeConfig({}).mode).toBe("disabled");
    expect(
      readRecommendationRuntimeConfig({
        CLOSETSEARCH_RECOMMENDATION_MODE: "force-active",
        CLOSETSEARCH_RECOMMENDATION_PROMOTION_APPROVED: "TRUE",
        CLOSETSEARCH_RECOMMENDATION_TIMEOUT_MS: "10000",
      }),
    ).toMatchObject({
      mode: "disabled",
      promotionApproved: false,
      timeoutMs: 25,
    });
  });

  it("keeps the deterministic rules ranker active when the flag is disabled", () => {
    const listings = candidateSet();
    const expected = rankListings({ listings });
    const runtime = new MlRecommendationRuntime({
      artifact: null,
      clock: () => now,
      config: createConfig({ mode: "disabled" }),
    });
    const result = runtime.rank({
      listings,
      userId: "anonymous",
    });

    expect(result.listings).toEqual(expected.listings);
    expect(result.recommendation).toMatchObject({
      fallbackReason: "feature_flag_disabled",
      rolloutMode: "disabled",
      strategy: "rules",
      usedModel: false,
    });
  });

  it("validates feature-schema and model versions before inference", () => {
    const listings = candidateSet();
    const schemaMismatch = new MlRecommendationRuntime({
      artifact: createArtifact({
        featureSchemaVersion: "recommendation-features/v0",
      }),
      clock: () => now,
      config: createConfig({ mode: "shadow" }),
    }).rank({ listings, userId: "user-1" });
    const versionMismatch = new MlRecommendationRuntime({
      artifact: createArtifact({ modelVersion: "unknown-model/v9" }),
      clock: () => now,
      config: createConfig({ mode: "shadow" }),
    }).rank({ listings, userId: "user-1" });

    expect(schemaMismatch.recommendation.fallbackReason).toBe("feature_schema_mismatch");
    expect(versionMismatch.recommendation.fallbackReason).toBe("model_version_mismatch");
    expect(schemaMismatch.listings).toEqual(rankListings({ listings }).listings);
  });

  it("rejects unavailable and structurally unsafe artifacts", () => {
    const listings = candidateSet();
    const unavailable = new MlRecommendationRuntime({
      clock: () => now,
      config: createConfig({
        artifactPath: "/definitely/missing/closetsearch-model.json",
        mode: "shadow",
      }),
    }).rank({ listings, userId: "user-1" });
    const unsafeArtifact = createArtifact();
    unsafeArtifact.itemPopularity.a1 = Number.POSITIVE_INFINITY;
    const invalid = new MlRecommendationRuntime({
      artifact: unsafeArtifact,
      clock: () => now,
      config: createConfig({ mode: "shadow" }),
    }).rank({ listings, userId: "user-1" });

    expect(unavailable.recommendation.fallbackReason).toBe("artifact_unavailable");
    expect(invalid.recommendation.fallbackReason).toBe("artifact_invalid");
  });

  it("runs only a shadow ranking while preserving the exact rules response", () => {
    const listings = candidateSet();
    const baseline = rankListings({ listings });
    const runtime = new MlRecommendationRuntime({
      artifact: createArtifact({ status: "shadow" }),
      clock: () => now,
      config: createConfig({
        mode: "shadow",
        promotionApproved: false,
      }),
    });
    const result = runtime.rank({
      listings,
      userId: "user-1",
    });

    expect(result.listings).toEqual(baseline.listings);
    expect(result.recommendation).toMatchObject({
      modelVersion: RECOMMENDATION_RUNTIME_MODEL_VERSION,
      rolloutMode: "shadow",
      strategy: "rules",
      usedModel: false,
    });
    expect(result.recommendation.shadow?.rankedItems).toHaveLength(listings.length);
    expect(result.recommendation.shadow?.comparedAtK).toBe(listings.length);
  });

  it("refuses active use without both deployment approval and a promoted artifact", () => {
    const listings = candidateSet();
    const missingApproval = new MlRecommendationRuntime({
      artifact: createArtifact(),
      clock: () => now,
      config: createConfig({ promotionApproved: false }),
    }).rank({ listings, userId: "user-1" });
    const shadowArtifact = new MlRecommendationRuntime({
      artifact: createArtifact({ status: "shadow" }),
      clock: () => now,
      config: createConfig(),
    }).rank({ listings, userId: "user-1" });

    expect(missingApproval.recommendation.fallbackReason).toBe("model_not_promoted");
    expect(shadowArtifact.recommendation.fallbackReason).toBe("model_not_promoted");
    expect(missingApproval.recommendation.usedModel).toBe(false);
  });

  it("falls back when a promoted artifact is stale", () => {
    const artifact = createArtifact({
      trainedAt: "2026-01-01T00:00:00.000Z",
    });
    artifact.metadata.trainingWindowEnd = "2025-12-31T00:00:00.000Z";
    const result = new MlRecommendationRuntime({
      artifact,
      clock: () => now,
      config: createConfig({ maximumArtifactAgeDays: 30 }),
    }).rank({ listings: candidateSet(), userId: "user-1" });

    expect(result.recommendation.fallbackReason).toBe("model_stale");
    expect(result.recommendation.strategy).toBe("rules");
  });

  it("uses the promoted model with bounded brand and provider dominance", () => {
    const listings = candidateSet();
    const runtime = new MlRecommendationRuntime({
      artifact: createArtifact(),
      clock: () => now,
      config: createConfig(),
    });
    const first = runtime.rank({ listings, userId: "user-1" });
    const second = runtime.rank({ listings, userId: "user-1" });
    const firstFive = first.listings.slice(0, 5);
    const kapitalCount = firstFive.filter((listing) => listing.brand.name === "Kapital").length;
    const grailedCount = firstFive.filter((listing) => listing.source.id === "grailed").length;

    expect(first.listings.map((listing) => listing.id)).toEqual(
      second.listings.map((listing) => listing.id),
    );
    expect(first.recommendation).toMatchObject({
      artifactId: "recommendation-production-snapshot-1",
      modelVersion: RECOMMENDATION_RUNTIME_MODEL_VERSION,
      strategy: "ml_hybrid",
      usedModel: true,
    });
    expect(kapitalCount).toBeLessThanOrEqual(3);
    expect(grailedCount).toBeLessThanOrEqual(4);
    expect(first.recommendation.rankedItems[0]?.reasonCodes).toContain("content_affinity");
    expect(JSON.stringify(first.recommendation)).not.toContain("featureWeights");
  });

  it("enforces the synchronous inference deadline and returns rules deterministically", () => {
    let time = now - 10;
    const listings = candidateSet();
    const baseline = rankListings({ listings });
    const runtime = new MlRecommendationRuntime({
      artifact: createArtifact(),
      clock: () => {
        time += 10;
        return time;
      },
      config: createConfig({ timeoutMs: 1 }),
    });
    const result = runtime.rank({ listings, userId: "user-1" });

    expect(result.recommendation.fallbackReason).toBe("inference_timeout");
    expect(result.recommendation.usedModel).toBe(false);
    expect(result.listings).toEqual(baseline.listings);
  });

  it("keeps non-active or malformed-price listings out of model scoring", () => {
    const active = createListing("a1");
    const sold = createListing("sold-1", { status: "sold" });
    const malformed = {
      ...createListing("bad-price"),
      price: {
        amount: Number.NaN,
        currency: "USD",
      },
    };
    const runtime = new MlRecommendationRuntime({
      artifact: createArtifact(),
      clock: () => now,
      config: createConfig(),
    });
    const result = runtime.rank({
      listings: [sold, malformed, active],
      userId: "user-1",
    });

    expect(result.recommendation.usedModel).toBe(true);
    expect(result.recommendation.rankedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          listingId: "sold-1",
          reasonCodes: ["rules_fallback"],
        }),
        expect.objectContaining({
          listingId: "bad-price",
          reasonCodes: ["rules_fallback"],
        }),
      ]),
    );
  });

  it("does not claim active model use when no candidate is eligible", () => {
    const sold = createListing("sold-1", { status: "sold" });
    const result = new MlRecommendationRuntime({
      artifact: createArtifact(),
      clock: () => now,
      config: createConfig(),
    }).rank({
      listings: [sold],
      userId: "user-1",
    });

    expect(result.recommendation).toMatchObject({
      fallbackReason: "no_eligible_candidates",
      strategy: "rules",
      usedModel: false,
    });
  });
});
