import {
  clamp,
  daysBetween,
  normalizeToken,
  roundMetric,
  seededUnitInterval,
  stableFingerprint,
  tokenize,
  toTimestamp,
} from "./deterministic.js";
import {
  DEFAULT_ML_SEED,
  RECOMMENDATION_FEATURE_SCHEMA_VERSION,
  RECOMMENDATION_MODEL_VERSION,
} from "./schema.js";
import type {
  DiversityConfig,
  RankedRecommendation,
  RecommendationArtifact,
  RecommendationEvent,
  RecommendationListing,
  RecommendationPreference,
  RecommendationReason,
  RecommendationRolloutMode,
  RecommendationRuntimeResult,
  RecommendationSnapshot,
  RecommendationUserProfile,
} from "./types.js";
import { validateRecommendationSnapshot } from "./validation.js";

export const DEFAULT_DIVERSITY_CONFIG: DiversityConfig = Object.freeze({
  brandPenalty: 0.14,
  maxBrandShare: 0.4,
  maxSourceShare: 0.55,
  sourcePenalty: 0.1,
});

export const DEFAULT_RECOMMENDATION_ROLLOUT_MODE: RecommendationRolloutMode = "shadow";

const eventWeights: Record<RecommendationEvent["eventType"], number> = {
  viewport: 0.2,
  click: 1,
  like: 3,
  save: 3.5,
  watchlist: 4,
  hide: -3,
};

interface MutableUserProfile {
  engagedListingWeights: Map<string, number>;
  featureWeights: Map<string, number>;
  positiveWeight: number;
}

interface ScoredRecommendation {
  brand: string;
  listingId: string;
  reasons: RecommendationReason[];
  score: number;
  source: string;
}

export interface RankRecommendationInput {
  artifact: RecommendationArtifact;
  asOf: string;
  candidates: RecommendationListing[];
  deadlineGuard?: () => void;
  diversity?: Partial<DiversityConfig>;
  preference?: RecommendationPreference;
  topK: number;
  userId: string;
}

export interface RecommendationRuntimeInput extends RankRecommendationInput {
  baselineRanker: (candidates: RecommendationListing[], topK: number) => string[];
  clock?: () => number;
  modelPromotionApproved?: boolean;
  rolloutMode?: RecommendationRolloutMode;
  timeoutMs?: number;
}

function addWeight(map: Map<string, number>, key: string, amount: number) {
  if (!key || amount === 0) {
    return;
  }

  map.set(key, (map.get(key) ?? 0) + amount);
}

function recommendationFeatureKeys(listing: RecommendationListing) {
  const priceBand = Math.floor(Math.log2(Math.max(1, listing.priceMinor / 100)));
  const currency = listing.currency.trim().toUpperCase();
  const keys = [
    `brand:${normalizeToken(listing.brand) || "unknown"}`,
    `category:${normalizeToken(listing.category) || "unknown"}`,
    `source:${normalizeToken(listing.source) || "unknown"}`,
    `price-band:${currency}:${priceBand}`,
  ];

  if (normalizeToken(listing.condition)) {
    keys.push(`condition:${normalizeToken(listing.condition)}`);
  }

  if (normalizeToken(listing.size)) {
    keys.push(`size:${normalizeToken(listing.size)}`);
  }

  for (const token of tokenize(listing.title).slice(0, 12)) {
    keys.push(`title:${token}`);
  }

  return keys;
}

function preferenceFeatureWeights(preference: RecommendationPreference | undefined) {
  const weights = new Map<string, number>();

  if (!preference) {
    return weights;
  }

  for (const brand of preference.favoriteBrands ?? []) {
    addWeight(weights, `brand:${normalizeToken(brand)}`, 2.5);
  }

  for (const category of preference.favoriteCategories ?? []) {
    addWeight(weights, `category:${normalizeToken(category)}`, 1.8);
  }

  for (const condition of preference.preferredConditions ?? []) {
    addWeight(weights, `condition:${normalizeToken(condition)}`, 0.8);
  }

  for (const size of preference.preferredSizes ?? []) {
    addWeight(weights, `size:${normalizeToken(size)}`, 0.9);
  }

  for (const source of preference.preferredSources ?? []) {
    addWeight(weights, `source:${normalizeToken(source)}`, 1.1);
  }

  for (const token of tokenize((preference.queryTerms ?? []).join(" "))) {
    addWeight(weights, `title:${token}`, 1.25);
  }

  return weights;
}

function serializeProfile(profile: MutableUserProfile): RecommendationUserProfile {
  return {
    engagedListingWeights: Object.fromEntries(
      Array.from(profile.engagedListingWeights.entries())
        .filter(([, weight]) => weight > 0)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([listingId, weight]) => [listingId, roundMetric(weight)]),
    ),
    featureWeights: Object.fromEntries(
      Array.from(profile.featureWeights.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([feature, weight]) => [feature, roundMetric(weight)]),
    ),
    positiveWeight: roundMetric(profile.positiveWeight),
  };
}

function buildItemCooccurrence(
  profiles: Record<string, RecommendationUserProfile>,
  popularity: Record<string, number>,
) {
  const rawPairs = new Map<string, Map<string, number>>();

  for (const profile of Object.values(profiles)) {
    const positiveItems = Object.entries(profile.engagedListingWeights)
      .filter(([, weight]) => weight >= 1)
      .sort(([left], [right]) => left.localeCompare(right));

    for (let leftIndex = 0; leftIndex < positiveItems.length; leftIndex += 1) {
      const [leftId, leftWeight] = positiveItems[leftIndex] ?? [];

      if (!leftId || leftWeight === undefined) {
        continue;
      }

      for (let rightIndex = leftIndex + 1; rightIndex < positiveItems.length; rightIndex += 1) {
        const [rightId, rightWeight] = positiveItems[rightIndex] ?? [];

        if (!rightId || rightWeight === undefined) {
          continue;
        }

        const pairWeight = Math.sqrt(leftWeight * rightWeight);

        if (!rawPairs.has(leftId)) {
          rawPairs.set(leftId, new Map());
        }

        if (!rawPairs.has(rightId)) {
          rawPairs.set(rightId, new Map());
        }

        addWeight(rawPairs.get(leftId)!, rightId, pairWeight);
        addWeight(rawPairs.get(rightId)!, leftId, pairWeight);
      }
    }
  }

  return Object.fromEntries(
    Array.from(rawPairs.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([listingId, neighbors]) => [
        listingId,
        Object.fromEntries(
          Array.from(neighbors.entries())
            .map(([neighborId, pairWeight]) => {
              const denominator = Math.sqrt(
                Math.max(popularity[listingId] ?? 0, 0.000_001) *
                  Math.max(popularity[neighborId] ?? 0, 0.000_001),
              );
              return [neighborId, roundMetric(pairWeight / denominator)] as const;
            })
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
      ]),
  );
}

export function trainRecommendationModel(snapshot: RecommendationSnapshot): RecommendationArtifact {
  const split = validateRecommendationSnapshot(snapshot);
  const listingById = new Map(snapshot.listings.map((listing) => [listing.listingId, listing]));
  const mutableProfiles = new Map<string, MutableUserProfile>();
  const popularity = new Map<string, number>();

  for (const event of split.train) {
    const listing = listingById.get(event.listingId);

    if (!listing) {
      continue;
    }

    const weight = eventWeights[event.eventType];
    const profile = mutableProfiles.get(event.userId) ?? {
      engagedListingWeights: new Map<string, number>(),
      featureWeights: new Map<string, number>(),
      positiveWeight: 0,
    };

    for (const feature of recommendationFeatureKeys(listing)) {
      addWeight(profile.featureWeights, feature, weight);
    }

    addWeight(profile.engagedListingWeights, event.listingId, weight);

    if (weight > 0) {
      profile.positiveWeight += weight;
      addWeight(popularity, event.listingId, weight);
    }

    mutableProfiles.set(event.userId, profile);
  }

  const userProfiles = Object.fromEntries(
    Array.from(mutableProfiles.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([userId, profile]) => [userId, serializeProfile(profile)]),
  );
  const itemPopularity = Object.fromEntries(
    Array.from(popularity.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([listingId, weight]) => [listingId, roundMetric(weight)]),
  );
  const trainingWindowEnd = split.train
    .map((event) => event.occurredAt)
    .sort()
    .at(-1);

  if (!trainingWindowEnd) {
    throw new Error("Recommendation training requires at least one pre-cutoff event.");
  }

  const trainingPayload = {
    events: split.train,
    listings: snapshot.listings
      .filter((listing) => split.train.some((event) => event.listingId === listing.listingId))
      .sort((left, right) => left.listingId.localeCompare(right.listingId)),
    preferences: snapshot.preferences,
    schema: RECOMMENDATION_FEATURE_SCHEMA_VERSION,
    seed: snapshot.metadata.seed ?? DEFAULT_ML_SEED,
  };
  const dataFingerprint = stableFingerprint(trainingPayload);

  return {
    itemCooccurrence: buildItemCooccurrence(userProfiles, itemPopularity),
    itemPopularity,
    metadata: {
      artifactId: `recommendation-${RECOMMENDATION_MODEL_VERSION.replaceAll("/", "-")}-${
        dataFingerprint
      }`,
      dataFingerprint,
      featureSchemaVersion: RECOMMENDATION_FEATURE_SCHEMA_VERSION,
      modelKind: "recommendation",
      modelVersion: RECOMMENDATION_MODEL_VERSION,
      seed: snapshot.metadata.seed ?? DEFAULT_ML_SEED,
      snapshotId: snapshot.metadata.snapshotId,
      status: "shadow",
      trainedAt: snapshot.metadata.createdAt,
      trainingWindowEnd,
    },
    trainingListingIds: Array.from(new Set(split.train.map((event) => event.listingId))).sort(),
    userProfiles,
  };
}

export function generateRecommendationCandidates(listings: RecommendationListing[], asOf: string) {
  const asOfTimestamp = toTimestamp(asOf, "recommendation asOf");
  const byId = new Map<string, RecommendationListing>();

  for (const listing of listings) {
    if (
      listing.marketStatus !== "active" ||
      toTimestamp(listing.availableAt, "listing.availableAt") > asOfTimestamp
    ) {
      continue;
    }

    const current = byId.get(listing.listingId);

    if (!current || listing.availableAt > current.availableAt) {
      byId.set(listing.listingId, listing);
    }
  }

  return Array.from(byId.values()).sort((left, right) =>
    left.listingId.localeCompare(right.listingId),
  );
}

function boundedAffinity(rawScore: number) {
  return rawScore / (1 + Math.abs(rawScore));
}

function scoreCandidate(
  listing: RecommendationListing,
  artifact: RecommendationArtifact,
  userId: string,
  preference: RecommendationPreference | undefined,
  asOf: string,
  allowUnscopedPricePreference: boolean,
) {
  const profile = artifact.userProfiles[userId];
  const candidateFeatures = recommendationFeatureKeys(listing);
  const preferenceWeights = preferenceFeatureWeights(preference);
  const isColdStart = !profile || profile.positiveWeight < 2;
  let contentRaw = 0;
  let preferenceRaw = 0;

  for (const feature of candidateFeatures) {
    contentRaw += profile?.featureWeights[feature] ?? 0;
    preferenceRaw += preferenceWeights.get(feature) ?? 0;
  }

  const preferenceCurrency = preference?.currency?.trim().toUpperCase();
  const comparablePricePreference =
    preference !== undefined &&
    (preferenceCurrency
      ? preferenceCurrency === listing.currency.trim().toUpperCase()
      : allowUnscopedPricePreference);

  if (preference && comparablePricePreference) {
    if (preference.minPriceMinor !== undefined && listing.priceMinor >= preference.minPriceMinor) {
      preferenceRaw += 0.5;
    }

    if (preference.maxPriceMinor !== undefined && listing.priceMinor <= preference.maxPriceMinor) {
      preferenceRaw += 0.7;
    }
  }

  let implicitRaw = 0;

  for (const [engagedListingId, engagedWeight] of Object.entries(
    profile?.engagedListingWeights ?? {},
  )) {
    implicitRaw +=
      (artifact.itemCooccurrence[engagedListingId]?.[listing.listingId] ?? 0) *
      Math.min(engagedWeight, 4);
  }

  const maximumPopularity = Math.max(1, ...Object.values(artifact.itemPopularity));
  const popularityScore =
    Math.log1p(artifact.itemPopularity[listing.listingId] ?? 0) / Math.log1p(maximumPopularity);
  const freshnessScore = clamp(1 - daysBetween(listing.availableAt, asOf) / 45, 0, 1);
  const contentScore = boundedAffinity(contentRaw / Math.max(candidateFeatures.length, 1));
  const implicitScore = boundedAffinity(implicitRaw);
  const preferenceScore = boundedAffinity(preferenceRaw / Math.max(preferenceWeights.size, 1));
  const reasons: RecommendationReason[] = [];
  let score: number;

  if (isColdStart) {
    score = preferenceScore * 0.65 + popularityScore * 0.2 + freshnessScore * 0.15;
    reasons.push({ code: "cold_start", contribution: 0 });

    if (Math.abs(preferenceScore) > 0.000_001) {
      reasons.push({
        code: "preference_affinity",
        contribution: roundMetric(preferenceScore * 0.65),
      });
    }
  } else {
    score =
      contentScore * 0.45 +
      implicitScore * 0.2 +
      preferenceScore * 0.15 +
      popularityScore * 0.1 +
      freshnessScore * 0.1;

    if (Math.abs(contentScore) > 0.000_001) {
      reasons.push({
        code: "content_affinity",
        contribution: roundMetric(contentScore * 0.45),
      });
    }

    if (Math.abs(implicitScore) > 0.000_001) {
      reasons.push({
        code: "implicit_affinity",
        contribution: roundMetric(implicitScore * 0.2),
      });
    }

    if (Math.abs(preferenceScore) > 0.000_001) {
      reasons.push({
        code: "preference_affinity",
        contribution: roundMetric(preferenceScore * 0.15),
      });
    }
  }

  if (popularityScore > 0) {
    reasons.push({
      code: "popularity",
      contribution: roundMetric(popularityScore * (isColdStart ? 0.2 : 0.1)),
    });
  }

  if (freshnessScore > 0) {
    reasons.push({
      code: "freshness",
      contribution: roundMetric(freshnessScore * (isColdStart ? 0.15 : 0.1)),
    });
  }

  return {
    brand: listing.brand,
    listingId: listing.listingId,
    reasons,
    score: roundMetric(score),
    source: listing.source,
  } satisfies ScoredRecommendation;
}

export function rerankForDiversity(
  candidates: ScoredRecommendation[],
  topK: number,
  inputConfig: Partial<DiversityConfig> = {},
) {
  const config: DiversityConfig = {
    ...DEFAULT_DIVERSITY_CONFIG,
    ...inputConfig,
  };
  const remaining = [...candidates];
  const selected: ScoredRecommendation[] = [];
  const brandCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const maxPerBrand = Math.max(1, Math.ceil(topK * config.maxBrandShare));
  const maxPerSource = Math.max(1, Math.ceil(topK * config.maxSourceShare));

  while (selected.length < topK && remaining.length > 0) {
    let bestIndex = -1;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;
    let relaxedQuota = false;

    for (let pass = 0; pass < 2 && bestIndex === -1; pass += 1) {
      relaxedQuota = pass === 1;

      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index];

        if (!candidate) {
          continue;
        }

        const brand = normalizeToken(candidate.brand) || "unknown";
        const source = normalizeToken(candidate.source) || "unknown";
        const brandCount = brandCounts.get(brand) ?? 0;
        const sourceCount = sourceCounts.get(source) ?? 0;

        if (!relaxedQuota && (brandCount >= maxPerBrand || sourceCount >= maxPerSource)) {
          continue;
        }

        const adjustedScore =
          candidate.score - brandCount * config.brandPenalty - sourceCount * config.sourcePenalty;

        if (
          adjustedScore > bestAdjustedScore ||
          (adjustedScore === bestAdjustedScore &&
            candidate.listingId.localeCompare(remaining[bestIndex]?.listingId ?? "") < 0)
        ) {
          bestAdjustedScore = adjustedScore;
          bestIndex = index;
        }
      }
    }

    const [chosen] = remaining.splice(bestIndex, 1);

    if (!chosen) {
      break;
    }

    const brand = normalizeToken(chosen.brand) || "unknown";
    const source = normalizeToken(chosen.source) || "unknown";
    const brandCount = brandCounts.get(brand) ?? 0;
    const sourceCount = sourceCounts.get(source) ?? 0;
    const diversityReasons = [...chosen.reasons];

    if (brandCount > 0) {
      diversityReasons.push({
        code: "brand_diversity",
        contribution: roundMetric(-brandCount * config.brandPenalty),
      });
    }

    if (sourceCount > 0) {
      diversityReasons.push({
        code: "source_diversity",
        contribution: roundMetric(-sourceCount * config.sourcePenalty),
      });
    }

    selected.push({
      ...chosen,
      reasons: diversityReasons,
      score: roundMetric(bestAdjustedScore),
    });
    brandCounts.set(brand, brandCount + 1);
    sourceCounts.set(source, sourceCount + 1);
  }

  return selected.map((candidate, index): RankedRecommendation => ({
    ...candidate,
    rank: index + 1,
  }));
}

export function rankRecommendations(input: RankRecommendationInput) {
  const candidates = generateRecommendationCandidates(input.candidates, input.asOf);
  const candidateCurrencies = new Set(
    candidates.map((listing) => listing.currency.trim().toUpperCase()),
  );
  const allowUnscopedPricePreference = candidateCurrencies.size === 1;
  const profile = input.artifact.userProfiles[input.userId];
  const engagedListingIds = new Set(
    Object.entries(profile?.engagedListingWeights ?? {})
      .filter(([, weight]) => weight >= 1)
      .map(([listingId]) => listingId),
  );
  const scored = candidates
    .filter((listing) => !engagedListingIds.has(listing.listingId))
    .map((listing) => {
      input.deadlineGuard?.();
      return scoreCandidate(
        listing,
        input.artifact,
        input.userId,
        input.preference,
        input.asOf,
        allowUnscopedPricePreference,
      );
    })
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      const leftTieBreak = seededUnitInterval(
        input.artifact.metadata.seed,
        `${input.userId}:${left.listingId}`,
      );
      const rightTieBreak = seededUnitInterval(
        input.artifact.metadata.seed,
        `${input.userId}:${right.listingId}`,
      );

      return leftTieBreak - rightTieBreak || left.listingId.localeCompare(right.listingId);
    });

  input.deadlineGuard?.();
  return rerankForDiversity(scored, input.topK, input.diversity);
}

class RecommendationInferenceTimeout extends Error {}

export function recommendWithFallback(
  input: RecommendationRuntimeInput,
): RecommendationRuntimeResult {
  const rolloutMode = input.rolloutMode ?? DEFAULT_RECOMMENDATION_ROLLOUT_MODE;
  const candidates = generateRecommendationCandidates(input.candidates, input.asOf);
  const baselineRanking = input.baselineRanker(candidates, input.topK);

  if (rolloutMode === "disabled") {
    return {
      fallbackReason: "feature_flag_disabled",
      ranking: baselineRanking,
      rolloutMode,
      usedModel: false,
    };
  }

  if (rolloutMode === "active" && input.modelPromotionApproved !== true) {
    return {
      fallbackReason: "model_not_promoted",
      modelVersion: input.artifact.metadata.modelVersion,
      ranking: baselineRanking,
      rolloutMode,
      usedModel: false,
    };
  }

  const clock = input.clock ?? Date.now;
  const deadline = clock() + Math.max(1, input.timeoutMs ?? 50);

  try {
    const modelRanking = rankRecommendations({
      ...input,
      candidates,
      deadlineGuard: () => {
        if (clock() > deadline) {
          throw new RecommendationInferenceTimeout("Recommendation inference timed out.");
        }
      },
    }).map((recommendation) => recommendation.listingId);

    if (rolloutMode === "shadow") {
      return {
        modelVersion: input.artifact.metadata.modelVersion,
        ranking: baselineRanking,
        rolloutMode,
        shadowRanking: modelRanking,
        usedModel: false,
      };
    }

    return {
      modelVersion: input.artifact.metadata.modelVersion,
      ranking: modelRanking,
      rolloutMode,
      usedModel: true,
    };
  } catch (error) {
    return {
      fallbackReason:
        error instanceof RecommendationInferenceTimeout ? "inference_timeout" : "inference_error",
      modelVersion: input.artifact.metadata.modelVersion,
      ranking: baselineRanking,
      rolloutMode,
      usedModel: false,
    };
  }
}
