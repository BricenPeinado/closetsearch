import {
  daysBetween,
  mean,
  normalizeToken,
  roundMetric,
  seededUnitInterval,
} from "./deterministic.js";
import {
  generateRecommendationCandidates,
  rankRecommendations,
} from "./recommender.js";
import type {
  PromotionCheck,
  PromotionDecision,
  RecommendationArtifact,
  RecommendationEvaluation,
  RecommendationEvent,
  RecommendationListing,
  RecommendationMetrics,
  RecommendationPreference,
} from "./types.js";

const relevantEventTypes = new Set(["click", "like", "save", "watchlist"]);

export interface RecommendationOfflineEvaluation {
  baseline: RecommendationEvaluation;
  candidate: RecommendationEvaluation;
  evaluationAsOf: string;
  evaluatedEventCount: number;
}

interface EvaluateRankerInput {
  artifact: RecommendationArtifact;
  asOf: string;
  evaluationEvents: RecommendationEvent[];
  k: number;
  listings: RecommendationListing[];
  preferences: RecommendationPreference[];
  ranker: (
    userId: string,
    preference: RecommendationPreference | undefined,
  ) => string[];
}

export interface PromotionGateInput {
  baseline: RecommendationEvaluation;
  candidate: RecommendationEvaluation;
  latencyP95Ms: number;
  minimumEvaluatedUsers?: number;
  minimumSnapshots?: number;
  reproducibleSnapshots: number;
}

function idealDcg(relevantCount: number, k: number) {
  let total = 0;

  for (let index = 0; index < Math.min(relevantCount, k); index += 1) {
    total += 1 / Math.log2(index + 2);
  }

  return total;
}

function hhi(values: string[]) {
  if (values.length === 0) {
    return 0;
  }

  const counts = new Map<string, number>();

  for (const value of values) {
    const key = normalizeToken(value) || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.values()).reduce((sum, count) => {
    const share = count / values.length;
    return sum + share * share;
  }, 0);
}

function pairwiseDiversity(
  ranking: string[],
  listingById: Map<string, RecommendationListing>,
) {
  const distances: number[] = [];

  for (let leftIndex = 0; leftIndex < ranking.length; leftIndex += 1) {
    const left = listingById.get(ranking[leftIndex] ?? "");

    if (!left) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < ranking.length; rightIndex += 1) {
      const right = listingById.get(ranking[rightIndex] ?? "");

      if (!right) {
        continue;
      }

      const distance =
        Number(normalizeToken(left.brand) !== normalizeToken(right.brand)) * 0.4 +
        Number(normalizeToken(left.category) !== normalizeToken(right.category)) * 0.3 +
        Number(normalizeToken(left.source) !== normalizeToken(right.source)) * 0.3;
      distances.push(distance);
    }
  }

  return mean(distances);
}

function evaluateRanker(input: EvaluateRankerInput): RecommendationEvaluation {
  const preferenceByUser = new Map(
    input.preferences.map((preference) => [preference.userId, preference]),
  );
  const relevantByUser = new Map<string, Set<string>>();

  for (const event of input.evaluationEvents) {
    if (!relevantEventTypes.has(event.eventType)) {
      continue;
    }

    const relevant = relevantByUser.get(event.userId) ?? new Set<string>();
    relevant.add(event.listingId);
    relevantByUser.set(event.userId, relevant);
  }

  const listingById = new Map(input.listings.map((listing) => [listing.listingId, listing]));
  const catalog = generateRecommendationCandidates(input.listings, input.asOf);
  const maximumPopularity = Math.max(
    1,
    ...Object.values(input.artifact.itemPopularity),
  );

  function metricsForUsers(userIds: string[]): RecommendationMetrics {
    const recalls: number[] = [];
    const ndcgs: number[] = [];
    const maps: number[] = [];
    const diversities: number[] = [];
    const noveltyValues: number[] = [];
    const recommendedIds = new Set<string>();
    const recommendedBrands: string[] = [];
    const recommendedSources: string[] = [];

    for (const userId of userIds) {
      const relevant = relevantByUser.get(userId) ?? new Set<string>();
      const ranking = input
        .ranker(userId, preferenceByUser.get(userId))
        .slice(0, input.k);
      let hits = 0;
      let dcg = 0;
      let precisionSum = 0;

      for (let index = 0; index < ranking.length; index += 1) {
        const listingId = ranking[index] ?? "";
        const listing = listingById.get(listingId);
        const isRelevant = relevant.has(listingId);

        if (isRelevant) {
          hits += 1;
          dcg += 1 / Math.log2(index + 2);
          precisionSum += hits / (index + 1);
        }

        if (listing) {
          recommendedIds.add(listingId);
          recommendedBrands.push(listing.brand);
          recommendedSources.push(listing.source);
          const popularityProbability =
            ((input.artifact.itemPopularity[listingId] ?? 0) + 1) /
            (maximumPopularity + catalog.length);
          noveltyValues.push(-Math.log2(popularityProbability));
        }
      }

      recalls.push(relevant.size > 0 ? hits / relevant.size : 0);
      ndcgs.push(
        relevant.size > 0
          ? dcg / Math.max(idealDcg(relevant.size, input.k), Number.EPSILON)
          : 0,
      );
      maps.push(
        relevant.size > 0
          ? precisionSum / Math.min(relevant.size, input.k)
          : 0,
      );
      diversities.push(pairwiseDiversity(ranking, listingById));
    }

    return {
      brandConcentration: roundMetric(hhi(recommendedBrands)),
      catalogCoverage: roundMetric(recommendedIds.size / Math.max(catalog.length, 1)),
      evaluatedUsers: userIds.length,
      intraListDiversity: roundMetric(mean(diversities)),
      mapAtK: roundMetric(mean(maps)),
      ndcgAtK: roundMetric(mean(ndcgs)),
      novelty: roundMetric(mean(noveltyValues)),
      providerConcentration: roundMetric(hhi(recommendedSources)),
      recallAtK: roundMetric(mean(recalls)),
    };
  }

  const userIds = Array.from(relevantByUser.keys()).sort();
  const coldStartUserIds = userIds.filter(
    (userId) => (input.artifact.userProfiles[userId]?.positiveWeight ?? 0) < 2,
  );

  return {
    allUsers: metricsForUsers(userIds),
    coldStartUsers: metricsForUsers(coldStartUserIds),
    k: input.k,
  };
}

export function rankPopularityFreshnessBaseline(
  artifact: RecommendationArtifact,
  listings: RecommendationListing[],
  userId: string,
  asOf: string,
  topK: number,
) {
  const profile = artifact.userProfiles[userId];
  const engaged = new Set(
    Object.entries(profile?.engagedListingWeights ?? {})
      .filter(([, weight]) => weight >= 1)
      .map(([listingId]) => listingId),
  );
  const maximumPopularity = Math.max(1, ...Object.values(artifact.itemPopularity));

  return generateRecommendationCandidates(listings, asOf)
    .filter((listing) => !engaged.has(listing.listingId))
    .map((listing) => ({
      listing,
      score:
        Math.log1p(artifact.itemPopularity[listing.listingId] ?? 0) /
          Math.log1p(maximumPopularity) *
          0.7 +
        Math.max(0, 1 - daysBetween(listing.availableAt, asOf) / 45) * 0.3,
    }))
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return (
        seededUnitInterval(
          artifact.metadata.seed,
          `${userId}:baseline:${left.listing.listingId}`,
        ) -
          seededUnitInterval(
            artifact.metadata.seed,
            `${userId}:baseline:${right.listing.listingId}`,
          ) ||
        left.listing.listingId.localeCompare(right.listing.listingId)
      );
    })
    .slice(0, topK)
    .map(({ listing }) => listing.listingId);
}

export function evaluateRecommendationModel(input: {
  artifact: RecommendationArtifact;
  evaluationEvents: RecommendationEvent[];
  evaluationAsOf: string;
  k: number;
  listings: RecommendationListing[];
  preferences: RecommendationPreference[];
}): RecommendationOfflineEvaluation {
  const shared = {
    artifact: input.artifact,
    asOf: input.evaluationAsOf,
    evaluationEvents: input.evaluationEvents,
    k: input.k,
    listings: input.listings,
    preferences: input.preferences,
  };
  const baseline = evaluateRanker({
    ...shared,
    ranker: (userId) =>
      rankPopularityFreshnessBaseline(
        input.artifact,
        input.listings,
        userId,
        input.evaluationAsOf,
        input.k,
      ),
  });
  const candidate = evaluateRanker({
    ...shared,
    ranker: (userId, preference) =>
      rankRecommendations({
        artifact: input.artifact,
        asOf: input.evaluationAsOf,
        candidates: input.listings,
        preference,
        topK: input.k,
        userId,
      }).map((recommendation) => recommendation.listingId),
  });

  return {
    baseline,
    candidate,
    evaluationAsOf: input.evaluationAsOf,
    evaluatedEventCount: input.evaluationEvents.length,
  };
}

function createCheck(
  name: string,
  actual: number,
  passed: boolean,
  required: string,
): PromotionCheck {
  return {
    actual: roundMetric(actual),
    name,
    passed,
    required,
  };
}

export function evaluateRecommendationPromotion(
  input: PromotionGateInput,
): PromotionDecision {
  const minimumEvaluatedUsers = input.minimumEvaluatedUsers ?? 100;
  const minimumSnapshots = input.minimumSnapshots ?? 3;
  const checks = [
    createCheck(
      "evaluated_users",
      input.candidate.allUsers.evaluatedUsers,
      input.candidate.allUsers.evaluatedUsers >= minimumEvaluatedUsers,
      `>= ${minimumEvaluatedUsers}`,
    ),
    createCheck(
      "reproducible_temporal_snapshots",
      input.reproducibleSnapshots,
      input.reproducibleSnapshots >= minimumSnapshots,
      `>= ${minimumSnapshots}`,
    ),
    createCheck(
      "ndcg_at_k_improvement",
      input.candidate.allUsers.ndcgAtK - input.baseline.allUsers.ndcgAtK,
      input.candidate.allUsers.ndcgAtK - input.baseline.allUsers.ndcgAtK >= 0.02,
      ">= +0.02 absolute",
    ),
    createCheck(
      "recall_at_k_non_degradation",
      input.candidate.allUsers.recallAtK - input.baseline.allUsers.recallAtK,
      input.candidate.allUsers.recallAtK - input.baseline.allUsers.recallAtK >= -0.005,
      ">= -0.005 absolute",
    ),
    createCheck(
      "diversity_non_degradation",
      input.candidate.allUsers.intraListDiversity -
        input.baseline.allUsers.intraListDiversity,
      input.candidate.allUsers.intraListDiversity >=
        input.baseline.allUsers.intraListDiversity - 0.02,
      "no worse than baseline - 0.02",
    ),
    createCheck(
      "catalog_coverage",
      input.candidate.allUsers.catalogCoverage,
      input.candidate.allUsers.catalogCoverage >=
        input.baseline.allUsers.catalogCoverage * 0.95,
      ">= 95% of baseline",
    ),
    createCheck(
      "provider_concentration",
      input.candidate.allUsers.providerConcentration,
      input.candidate.allUsers.providerConcentration <=
        input.baseline.allUsers.providerConcentration + 0.03,
      "<= baseline + 0.03",
    ),
    createCheck(
      "brand_concentration",
      input.candidate.allUsers.brandConcentration,
      input.candidate.allUsers.brandConcentration <=
        input.baseline.allUsers.brandConcentration + 0.03,
      "<= baseline + 0.03",
    ),
    createCheck(
      "cold_start_ndcg",
      input.candidate.coldStartUsers.ndcgAtK -
        input.baseline.coldStartUsers.ndcgAtK,
      input.candidate.coldStartUsers.ndcgAtK >=
        input.baseline.coldStartUsers.ndcgAtK - 0.02,
      "no worse than baseline - 0.02",
    ),
    createCheck(
      "inference_latency_p95_ms",
      input.latencyP95Ms,
      input.latencyP95Ms <= 75,
      "<= 75ms",
    ),
  ];
  const failedChecks = checks.filter((check) => !check.passed);

  return {
    approved: failedChecks.length === 0,
    checks,
    reasons: failedChecks.map(
      (check) => `${check.name} was ${check.actual}; required ${check.required}.`,
    ),
  };
}
