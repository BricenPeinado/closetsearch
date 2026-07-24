import { readFileSync, statSync } from "node:fs";
import type {
  FeedPersonalizationDebug,
  FeedRecommendationMetadata,
  Listing,
  RankedRecommendationMetadata,
  RecommendationFallbackReason,
  RecommendationRolloutMode,
} from "@closetsearch/shared";
import { incrementCounter, setGauge } from "../metrics.js";
import type { PersonalizationProfile } from "./personalizationSignalsService.js";
import { rankListings } from "./recommendationService.js";

export const RECOMMENDATION_RUNTIME_FEATURE_SCHEMA_VERSION = "recommendation-features/v1";
export const RECOMMENDATION_RUNTIME_MODEL_VERSION = "implicit-content-hybrid/v1";

const defaultInferenceTimeoutMs = 25;
const defaultMaximumArtifactAgeDays = 45;
const maximumArtifactBytes = 16 * 1024 * 1024;
const maximumCandidates = 500;
const maximumArtifactEntries = 100_000;

type ArtifactLifecycleStatus = "candidate" | "shadow" | "promoted" | "retired";

interface ArtifactMetadata {
  artifactId: string;
  dataFingerprint: string;
  featureSchemaVersion: string;
  modelKind: "recommendation";
  modelVersion: string;
  seed: number;
  snapshotId: string;
  status: ArtifactLifecycleStatus;
  trainedAt: string;
  trainingWindowEnd: string;
}

interface ArtifactUserProfile {
  engagedListingWeights: Record<string, number>;
  featureWeights: Record<string, number>;
  positiveWeight: number;
}

export interface RecommendationRuntimeArtifact {
  itemCooccurrence: Record<string, Record<string, number>>;
  itemPopularity: Record<string, number>;
  metadata: ArtifactMetadata;
  trainingListingIds: string[];
  userProfiles: Record<string, ArtifactUserProfile>;
}

export interface RecommendationRuntimeConfig {
  artifactPath?: string;
  maximumArtifactAgeDays: number;
  mode: RecommendationRolloutMode;
  promotionApproved: boolean;
  timeoutMs: number;
}

interface ModelCandidate {
  availableAt: string;
  brand: string;
  category: string;
  condition?: string;
  currency: string;
  listing: Listing;
  priceMinor: number;
  size?: string;
  source: string;
  title: string;
}

interface ModelRankedItem {
  listing: Listing;
  reasonCodes: string[];
  score: number;
}

interface ArtifactValidationFailure {
  artifact?: undefined;
  fallbackReason: RecommendationFallbackReason;
}

interface ArtifactValidationSuccess {
  artifact: RecommendationRuntimeArtifact;
  fallbackReason?: undefined;
}

type ArtifactValidationResult = ArtifactValidationFailure | ArtifactValidationSuccess;

export interface RankFeedWithMlInput {
  engagementByListingId?: ReadonlyMap<string, number>;
  includeDebug?: boolean;
  listings: Listing[];
  profile?: PersonalizationProfile;
  userId: string;
}

export interface RankFeedWithMlResult {
  debugPersonalization?: FeedPersonalizationDebug;
  isPersonalized: boolean;
  listings: Listing[];
  personalizationSummary: ReturnType<typeof rankListings>["personalizationSummary"];
  recommendation: FeedRecommendationMetadata;
}

export interface RecommendationRuntimeOptions {
  artifact?: unknown;
  clock?: () => number;
  config: RecommendationRuntimeConfig;
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }

  return parsed;
}

export function readRecommendationRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RecommendationRuntimeConfig {
  const rawMode = environment.CLOSETSEARCH_RECOMMENDATION_MODE?.trim();
  const mode: RecommendationRolloutMode =
    rawMode === "shadow" || rawMode === "active" || rawMode === "disabled" ? rawMode : "disabled";

  return {
    artifactPath: environment.CLOSETSEARCH_RECOMMENDATION_ARTIFACT_PATH?.trim() || undefined,
    maximumArtifactAgeDays: parseBoundedInteger(
      environment.CLOSETSEARCH_RECOMMENDATION_MAX_ARTIFACT_AGE_DAYS,
      defaultMaximumArtifactAgeDays,
      1,
      365,
    ),
    mode,
    promotionApproved: environment.CLOSETSEARCH_RECOMMENDATION_PROMOTION_APPROVED === "true",
    timeoutMs: parseBoundedInteger(
      environment.CLOSETSEARCH_RECOMMENDATION_TIMEOUT_MS,
      defaultInferenceTimeoutMs,
      1,
      250,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumberRecord(
  value: unknown,
  options: { maximumAbsolute?: number; minimum?: number } = {},
): value is Record<string, number> {
  if (!isRecord(value) || Object.keys(value).length > maximumArtifactEntries) {
    return false;
  }

  return Object.values(value).every(
    (entry) =>
      typeof entry === "number" &&
      Number.isFinite(entry) &&
      (options.minimum === undefined || entry >= options.minimum) &&
      (options.maximumAbsolute === undefined || Math.abs(entry) <= options.maximumAbsolute),
  );
}

function isArtifactUserProfile(value: unknown): value is ArtifactUserProfile {
  return (
    isRecord(value) &&
    isFiniteNumberRecord(value.engagedListingWeights, {
      maximumAbsolute: 1_000_000,
      minimum: 0,
    }) &&
    isFiniteNumberRecord(value.featureWeights, {
      maximumAbsolute: 1_000_000,
    }) &&
    typeof value.positiveWeight === "number" &&
    Number.isFinite(value.positiveWeight) &&
    value.positiveWeight >= 0 &&
    value.positiveWeight <= 1_000_000
  );
}

function validateArtifact(value: unknown): ArtifactValidationResult {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    return { fallbackReason: "artifact_invalid" };
  }

  const metadata = value.metadata;

  if (metadata.featureSchemaVersion !== RECOMMENDATION_RUNTIME_FEATURE_SCHEMA_VERSION) {
    return { fallbackReason: "feature_schema_mismatch" };
  }

  if (metadata.modelVersion !== RECOMMENDATION_RUNTIME_MODEL_VERSION) {
    return { fallbackReason: "model_version_mismatch" };
  }

  const lifecycleStatuses = new Set<ArtifactLifecycleStatus>([
    "candidate",
    "shadow",
    "promoted",
    "retired",
  ]);
  const metadataIsValid =
    typeof metadata.artifactId === "string" &&
    metadata.artifactId.length > 0 &&
    typeof metadata.dataFingerprint === "string" &&
    /^[a-f0-9]{8,64}$/.test(metadata.dataFingerprint) &&
    metadata.modelKind === "recommendation" &&
    typeof metadata.seed === "number" &&
    Number.isSafeInteger(metadata.seed) &&
    typeof metadata.snapshotId === "string" &&
    metadata.snapshotId.length > 0 &&
    typeof metadata.status === "string" &&
    lifecycleStatuses.has(metadata.status as ArtifactLifecycleStatus) &&
    typeof metadata.trainedAt === "string" &&
    Number.isFinite(Date.parse(metadata.trainedAt)) &&
    typeof metadata.trainingWindowEnd === "string" &&
    Number.isFinite(Date.parse(metadata.trainingWindowEnd)) &&
    Date.parse(metadata.trainingWindowEnd) <= Date.parse(metadata.trainedAt);

  if (!metadataIsValid) {
    return { fallbackReason: "artifact_invalid" };
  }

  if (
    !isFiniteNumberRecord(value.itemPopularity, {
      maximumAbsolute: 1_000_000,
      minimum: 0,
    }) ||
    !isRecord(value.itemCooccurrence) ||
    Object.keys(value.itemCooccurrence).length > maximumArtifactEntries ||
    !Object.values(value.itemCooccurrence).every((entry) =>
      isFiniteNumberRecord(entry, {
        maximumAbsolute: 1_000_000,
        minimum: 0,
      }),
    ) ||
    !isRecord(value.userProfiles) ||
    Object.keys(value.userProfiles).length > maximumArtifactEntries ||
    !Object.values(value.userProfiles).every(isArtifactUserProfile) ||
    !Array.isArray(value.trainingListingIds) ||
    value.trainingListingIds.length > maximumArtifactEntries ||
    !value.trainingListingIds.every(
      (listingId) => typeof listingId === "string" && listingId.length > 0,
    )
  ) {
    return { fallbackReason: "artifact_invalid" };
  }

  return {
    artifact: value as unknown as RecommendationRuntimeArtifact,
  };
}

function loadArtifact(path: string | undefined): ArtifactValidationResult {
  if (!path) {
    return { fallbackReason: "artifact_unavailable" };
  }

  try {
    if (statSync(path).size > maximumArtifactBytes) {
      return { fallbackReason: "artifact_invalid" };
    }

    return validateArtifact(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (error) {
    if (isRecord(error) && typeof error.code === "string" && error.code === "ENOENT") {
      return { fallbackReason: "artifact_unavailable" };
    }

    return { fallbackReason: "artifact_invalid" };
  }
}

function normalizeToken(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function toMinorUnits(listing: Listing) {
  const money = listing.pricing?.comparison ?? listing.pricing?.original ?? listing.price;
  const fractionDigits = money.fractionDigits ?? 2;
  const amountMinor = money.amountMinor ?? Math.round(money.amount * 10 ** fractionDigits);

  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    return undefined;
  }

  return {
    amountMinor,
    currency: money.currency.trim().toUpperCase(),
  };
}

function toModelCandidates(listings: Listing[]) {
  const candidates: ModelCandidate[] = [];
  const seenListingIds = new Set<string>();

  for (const listing of listings) {
    if (candidates.length >= maximumCandidates || seenListingIds.has(listing.id)) {
      continue;
    }

    const lifecycleStatus = listing.lifecycle?.status ?? listing.market?.status ?? "active";

    if (lifecycleStatus !== "active") {
      continue;
    }

    const price = toMinorUnits(listing);
    const availableAt =
      listing.lifecycle?.listedAt ?? listing.freshness?.sourceUpdatedAt ?? listing.fetchedAt;

    if (!price || !Number.isFinite(Date.parse(availableAt))) {
      continue;
    }

    seenListingIds.add(listing.id);
    candidates.push({
      availableAt,
      brand: listing.brand.name,
      category: listing.category ?? "unknown",
      condition: listing.condition,
      currency: price.currency,
      listing,
      priceMinor: price.amountMinor,
      size: listing.size,
      source: listing.source.id,
      title: listing.title,
    });
  }

  return candidates;
}

function priceBand(priceMinor: number) {
  return Math.floor(Math.log2(Math.max(1, priceMinor / 100)));
}

function candidateFeatureKeys(candidate: ModelCandidate, usePriceFeature: boolean) {
  const keys = [
    `brand:${normalizeToken(candidate.brand) || "unknown"}`,
    `category:${normalizeToken(candidate.category) || "unknown"}`,
    `source:${normalizeToken(candidate.source) || "unknown"}`,
  ];

  if (usePriceFeature) {
    keys.push(`price-band:${priceBand(candidate.priceMinor)}`);
  }

  if (normalizeToken(candidate.condition)) {
    keys.push(`condition:${normalizeToken(candidate.condition)}`);
  }

  if (normalizeToken(candidate.size)) {
    keys.push(`size:${normalizeToken(candidate.size)}`);
  }

  const titleTokens = Array.from(
    new Set(
      candidate.title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2),
    ),
  )
    .sort()
    .slice(0, 12);

  for (const token of titleTokens) {
    keys.push(`title:${token}`);
  }

  return keys;
}

function livePreferenceWeights(profile: PersonalizationProfile | undefined) {
  const weights = new Map<string, number>();

  function copySignals(prefix: string, values: ReadonlyMap<string, number>) {
    for (const [value, weight] of values.entries()) {
      const key = normalizeToken(value);

      if (key && Number.isFinite(weight)) {
        weights.set(`${prefix}:${key}`, weight);
      }
    }
  }

  if (profile) {
    copySignals("brand", profile.brandAffinities);
    copySignals("category", profile.categoryAffinities);
    copySignals("condition", profile.conditionAffinities);
    copySignals("size", profile.sizeAffinities);
    copySignals("source", profile.sourceAffinities);
    copySignals("title", profile.queryTermAffinities);
  }

  return weights;
}

function boundedAffinity(value: number) {
  return value / (1 + Math.abs(value));
}

function roundScore(value: number) {
  return Number(value.toFixed(6));
}

function scoreCandidates(input: {
  artifact: RecommendationRuntimeArtifact;
  asOfMs: number;
  candidates: ModelCandidate[];
  deadlineGuard: () => void;
  profile?: PersonalizationProfile;
  userId: string;
}) {
  const artifactProfile = input.artifact.userProfiles[input.userId];
  const liveWeights = livePreferenceWeights(input.profile);
  const commonCurrencies = new Set(input.candidates.map((candidate) => candidate.currency));
  const usePriceFeature = commonCurrencies.size === 1;
  const maximumPopularity = Math.max(1, ...Object.values(input.artifact.itemPopularity));
  const engagedListingIds = new Set(
    Object.entries(artifactProfile?.engagedListingWeights ?? {})
      .filter(([, weight]) => weight >= 1)
      .map(([listingId]) => listingId),
  );

  return input.candidates
    .filter((candidate) => !engagedListingIds.has(candidate.listing.id))
    .map((candidate): ModelRankedItem => {
      input.deadlineGuard();
      const features = candidateFeatureKeys(candidate, usePriceFeature);
      let artifactContentRaw = 0;
      let livePreferenceRaw = 0;

      for (const feature of features) {
        artifactContentRaw += artifactProfile?.featureWeights[feature] ?? 0;
        livePreferenceRaw += liveWeights.get(feature) ?? 0;
      }

      let implicitRaw = 0;

      for (const [listingId, weight] of Object.entries(
        artifactProfile?.engagedListingWeights ?? {},
      )) {
        implicitRaw +=
          (input.artifact.itemCooccurrence[listingId]?.[candidate.listing.id] ?? 0) *
          Math.min(weight, 4);
      }

      const contentScore = boundedAffinity(artifactContentRaw / Math.max(features.length, 1));
      const implicitScore = boundedAffinity(implicitRaw);
      const preferenceScore = boundedAffinity(livePreferenceRaw / Math.max(liveWeights.size, 1));
      const popularityScore =
        Math.log1p(input.artifact.itemPopularity[candidate.listing.id] ?? 0) /
        Math.log1p(maximumPopularity);
      const ageDays = Math.max(
        0,
        (input.asOfMs - Date.parse(candidate.availableAt)) / (24 * 60 * 60 * 1000),
      );
      const freshnessScore = Math.max(0, 1 - ageDays / 45);
      const coldStart = !artifactProfile || artifactProfile.positiveWeight < 2;
      const reasonCodes: string[] = [];
      let score: number;

      if (coldStart) {
        score = preferenceScore * 0.65 + popularityScore * 0.2 + freshnessScore * 0.15;
        reasonCodes.push("cold_start");

        if (preferenceScore > 0) {
          reasonCodes.push("preference_affinity");
        }
      } else {
        score =
          contentScore * 0.45 +
          implicitScore * 0.2 +
          preferenceScore * 0.15 +
          popularityScore * 0.1 +
          freshnessScore * 0.1;

        if (contentScore > 0) {
          reasonCodes.push("content_affinity");
        }

        if (implicitScore > 0) {
          reasonCodes.push("implicit_affinity");
        }

        if (preferenceScore > 0) {
          reasonCodes.push("preference_affinity");
        }
      }

      if (popularityScore > 0) {
        reasonCodes.push("popularity");
      }

      if (freshnessScore > 0) {
        reasonCodes.push("freshness");
      }

      return {
        listing: candidate.listing,
        reasonCodes,
        score: roundScore(score),
      };
    })
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.listing.id.localeCompare(right.listing.id);
    });
}

function selectWithDominanceSafeguards(
  ranked: ModelRankedItem[],
  topK: number,
  deadlineGuard: () => void,
) {
  const remaining = [...ranked];
  const selected: ModelRankedItem[] = [];
  const brandCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const maximumBrandCount = Math.max(1, Math.ceil(topK * 0.4));
  const maximumSourceCount = Math.max(1, Math.ceil(topK * 0.55));

  while (selected.length < topK && remaining.length > 0) {
    deadlineGuard();
    let selectedIndex = -1;

    for (let pass = 0; pass < 2 && selectedIndex === -1; pass += 1) {
      for (let index = 0; index < remaining.length; index += 1) {
        deadlineGuard();
        const candidate = remaining[index];

        if (!candidate) {
          continue;
        }

        const brand = normalizeToken(candidate.listing.brand.name) || "unknown";
        const source = normalizeToken(candidate.listing.source.id) || "unknown";
        const exceedsQuota =
          (brandCounts.get(brand) ?? 0) >= maximumBrandCount ||
          (sourceCounts.get(source) ?? 0) >= maximumSourceCount;

        if (pass === 0 && exceedsQuota) {
          continue;
        }

        selectedIndex = index;
        break;
      }
    }

    const [chosen] = remaining.splice(selectedIndex, 1);

    if (!chosen) {
      break;
    }

    const brand = normalizeToken(chosen.listing.brand.name) || "unknown";
    const source = normalizeToken(chosen.listing.source.id) || "unknown";
    const brandCount = brandCounts.get(brand) ?? 0;
    const sourceCount = sourceCounts.get(source) ?? 0;
    const reasonCodes = [...chosen.reasonCodes];

    if (brandCount > 0) {
      reasonCodes.push("brand_diversity");
    }

    if (sourceCount > 0) {
      reasonCodes.push("source_diversity");
    }

    selected.push({
      ...chosen,
      reasonCodes: Array.from(new Set(reasonCodes)),
    });
    brandCounts.set(brand, brandCount + 1);
    sourceCounts.set(source, sourceCount + 1);
  }

  return selected;
}

function toRankedMetadata(
  ranked: Array<{ listing: Listing; reasonCodes: string[] }>,
): RankedRecommendationMetadata[] {
  return ranked.map((item, index) => ({
    listingId: item.listing.id,
    rank: index + 1,
    reasonCodes: item.reasonCodes,
  }));
}

function rulesMetadata(listings: Listing[], debug: FeedPersonalizationDebug | undefined) {
  const breakdowns = new Map(
    (debug?.scoreBreakdowns ?? []).map((breakdown) => [
      breakdown.listingId,
      breakdown.reasons.map((reason) => reason.code),
    ]),
  );

  return listings.map((listing, index) => ({
    listing,
    reasonCodes: breakdowns.get(listing.id) ?? ["newest"],
    rank: index + 1,
  }));
}

function isArtifactStale(
  artifact: RecommendationRuntimeArtifact,
  nowMs: number,
  maximumAgeDays: number,
) {
  const artifactAgeMs = nowMs - Date.parse(artifact.metadata.trainedAt);
  return artifactAgeMs > maximumAgeDays * 24 * 60 * 60 * 1000;
}

class InferenceTimeoutError extends Error {}

export class MlRecommendationRuntime {
  private readonly artifactValidation: ArtifactValidationResult;
  private readonly clock: () => number;
  private readonly config: RecommendationRuntimeConfig;

  constructor(options: RecommendationRuntimeOptions) {
    this.config = options.config;
    this.clock = options.clock ?? Date.now;
    this.artifactValidation =
      options.artifact === undefined
        ? loadArtifact(options.config.artifactPath)
        : validateArtifact(options.artifact);
  }

  rank(input: RankFeedWithMlInput): RankFeedWithMlResult {
    const rules = rankListings({
      engagementByListingId: input.engagementByListingId,
      includeDebug: true,
      listings: input.listings,
      profile: input.profile,
    });
    const rulesItems = rulesMetadata(rules.listings, rules.debugPersonalization);
    const rulesRankedMetadata = toRankedMetadata(rulesItems);
    const buildRulesResult = (
      fallbackReason: RecommendationFallbackReason,
      artifact?: RecommendationRuntimeArtifact,
    ): RankFeedWithMlResult => {
      incrementCounter("closetsearch_recommendation_fallback_total", {
        reason: fallbackReason,
      });
      incrementCounter("closetsearch_recommendation_requests_total", {
        model_version: artifact?.metadata.modelVersion ?? "none",
        rollout_mode: this.config.mode,
        strategy: "rules",
      });

      return {
        ...rules,
        debugPersonalization: input.includeDebug ? rules.debugPersonalization : undefined,
        recommendation: {
          artifactId: artifact?.metadata.artifactId,
          fallbackReason,
          featureSchemaVersion: artifact?.metadata.featureSchemaVersion,
          modelVersion: artifact?.metadata.modelVersion,
          rankedItems: rulesRankedMetadata,
          rolloutMode: this.config.mode,
          strategy: "rules",
          usedModel: false,
        },
      };
    };

    if (this.config.mode === "disabled") {
      return buildRulesResult("feature_flag_disabled");
    }

    if (!this.artifactValidation.artifact) {
      return buildRulesResult(this.artifactValidation.fallbackReason);
    }

    const artifact = this.artifactValidation.artifact;

    if (
      artifact.metadata.status === "retired" ||
      (this.config.mode === "active" &&
        (!this.config.promotionApproved || artifact.metadata.status !== "promoted"))
    ) {
      return buildRulesResult("model_not_promoted", artifact);
    }

    const startedAt = this.clock();
    const trainedAt = Date.parse(artifact.metadata.trainedAt);

    if (this.config.mode === "active" && trainedAt > startedAt + 5 * 60 * 1000) {
      return buildRulesResult("artifact_invalid", artifact);
    }

    if (
      this.config.mode === "active" &&
      isArtifactStale(artifact, startedAt, this.config.maximumArtifactAgeDays)
    ) {
      return buildRulesResult("model_stale", artifact);
    }

    const deadline = startedAt + this.config.timeoutMs;

    try {
      const candidates = toModelCandidates(input.listings);

      if (this.config.mode === "active" && candidates.length === 0) {
        return buildRulesResult("no_eligible_candidates", artifact);
      }

      const deadlineGuard = () => {
        if (this.clock() >= deadline) {
          throw new InferenceTimeoutError("Recommendation inference exceeded its deadline.");
        }
      };
      const ranked = selectWithDominanceSafeguards(
        scoreCandidates({
          artifact,
          asOfMs: startedAt,
          candidates,
          deadlineGuard,
          profile: input.profile,
          userId: input.userId,
        }),
        candidates.length,
        deadlineGuard,
      );
      deadlineGuard();

      const rankedIds = new Set(ranked.map((item) => item.listing.id));
      const completeRanking = [
        ...ranked,
        ...rulesItems
          .filter((item) => !rankedIds.has(item.listing.id))
          .map((item) => ({
            listing: item.listing,
            reasonCodes: ["rules_fallback"],
            score: Number.NEGATIVE_INFINITY,
          })),
      ];
      const modelMetadata = toRankedMetadata(completeRanking);
      const durationMs = Math.max(0, this.clock() - startedAt);

      setGauge(
        "closetsearch_recommendation_inference_duration_ms",
        { model_version: artifact.metadata.modelVersion },
        durationMs,
      );

      if (this.config.mode === "shadow") {
        const comparedAtK = Math.min(10, rulesItems.length, completeRanking.length);
        const rulesTopK = new Set(rulesItems.slice(0, comparedAtK).map((item) => item.listing.id));
        const overlapAtK = completeRanking
          .slice(0, comparedAtK)
          .filter((item) => rulesTopK.has(item.listing.id)).length;

        incrementCounter("closetsearch_recommendation_requests_total", {
          model_version: artifact.metadata.modelVersion,
          rollout_mode: this.config.mode,
          strategy: "rules",
        });

        return {
          ...rules,
          debugPersonalization: input.includeDebug ? rules.debugPersonalization : undefined,
          recommendation: {
            artifactId: artifact.metadata.artifactId,
            featureSchemaVersion: artifact.metadata.featureSchemaVersion,
            modelVersion: artifact.metadata.modelVersion,
            rankedItems: rulesRankedMetadata,
            rolloutMode: this.config.mode,
            shadow: {
              comparedAtK,
              overlapAtK,
              rankedItems: modelMetadata,
            },
            strategy: "rules",
            usedModel: false,
          },
        };
      }

      incrementCounter("closetsearch_recommendation_requests_total", {
        model_version: artifact.metadata.modelVersion,
        rollout_mode: this.config.mode,
        strategy: "ml_hybrid",
      });

      return {
        ...rules,
        debugPersonalization: input.includeDebug ? rules.debugPersonalization : undefined,
        listings: completeRanking.map((item) => item.listing),
        recommendation: {
          artifactId: artifact.metadata.artifactId,
          featureSchemaVersion: artifact.metadata.featureSchemaVersion,
          modelVersion: artifact.metadata.modelVersion,
          rankedItems: modelMetadata,
          rolloutMode: this.config.mode,
          strategy: "ml_hybrid",
          usedModel: true,
        },
      };
    } catch (error) {
      return buildRulesResult(
        error instanceof InferenceTimeoutError ? "inference_timeout" : "inference_error",
        artifact,
      );
    }
  }
}

let cachedRuntime:
  | {
      configKey: string;
      runtime: MlRecommendationRuntime;
    }
  | undefined;

function runtimeConfigKey(config: RecommendationRuntimeConfig) {
  return JSON.stringify(config);
}

export function getMlRecommendationRuntime() {
  const config = readRecommendationRuntimeConfig();
  const configKey = runtimeConfigKey(config);

  if (!cachedRuntime || cachedRuntime.configKey !== configKey) {
    cachedRuntime = {
      configKey,
      runtime: new MlRecommendationRuntime({ config }),
    };
  }

  return cachedRuntime.runtime;
}
