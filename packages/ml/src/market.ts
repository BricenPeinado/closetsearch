import {
  clamp,
  countDistribution,
  daysBetween,
  median,
  normalizeToken,
  quantile,
  roundMetric,
  stableFingerprint,
  tokenize,
  totalVariationDistance,
  toTimestamp,
} from "./deterministic.js";
import { FAIR_VALUE_MODEL_VERSION, MARKET_FEATURE_SCHEMA_VERSION } from "./schema.js";
import { assertTemporalIsolation, createTemporalSplit } from "./temporal.js";
import type {
  ComparableListing,
  DriftReport,
  FairValueArtifact,
  FairValuePrediction,
  MarketEstimate,
  MarketObservation,
  MarketSnapshot,
  ObservedRange,
  RobustOutlierPolicy,
  RobustSegmentStatistics,
} from "./types.js";
import { validateMarketSnapshot } from "./validation.js";

export interface FairValueTrainingConfig {
  minimumCalibrationSamplesForModelUse: number;
  minimumSegmentCalibrationSamples: number;
  minimumTrainingSamples: number;
  ridgeLambda: number;
}

export interface TrainFairValueInput {
  config?: Partial<FairValueTrainingConfig>;
  snapshot: MarketSnapshot;
}

export interface MarketDriftConfig {
  maximumAgeDays: number;
  maximumDistributionDistance: number;
  maximumUnseenCategoricalRate: number;
}

export interface MarketEstimateInput {
  allowShadowModel?: boolean;
  artifact: FairValueArtifact;
  asOf: string;
  drift?: DriftReport;
  minimumComparables?: number;
  minimumModelCalibrationSamples?: number;
  observations: MarketObservation[];
  target: MarketObservation;
}

const defaultFairValueTrainingConfig: FairValueTrainingConfig = {
  minimumCalibrationSamplesForModelUse: 30,
  minimumSegmentCalibrationSamples: 20,
  minimumTrainingSamples: 8,
  ridgeLambda: 1,
};

const defaultDriftConfig: MarketDriftConfig = {
  maximumAgeDays: 45,
  maximumDistributionDistance: 0.25,
  maximumUnseenCategoricalRate: 0.2,
};

function segmentKey(observation: MarketObservation) {
  return [
    normalizeToken(observation.canonicalBrand),
    normalizeToken(observation.category),
    observation.normalizedCurrency,
  ].join("|");
}

function soldTargetMinor(observation: MarketObservation) {
  if (observation.status !== "sold" || observation.soldPriceMinor === undefined) {
    throw new Error(
      `Observation ${observation.observationId} does not have a confirmed sold target.`,
    );
  }

  return observation.soldPriceMinor;
}

export function prepareMarketObservations(snapshot: MarketSnapshot) {
  validateMarketSnapshot(snapshot);
  const observationByDedupeKey = new Map<string, MarketObservation>();

  for (const observation of snapshot.observations) {
    const current = observationByDedupeKey.get(observation.deduplicationKey);

    if (
      !current ||
      observation.observedAt > current.observedAt ||
      (observation.observedAt === current.observedAt &&
        observation.observationId.localeCompare(current.observationId) > 0)
    ) {
      observationByDedupeKey.set(observation.deduplicationKey, observation);
    }
  }

  return Array.from(observationByDedupeKey.values()).sort((left, right) =>
    left.observationId.localeCompare(right.observationId),
  );
}

export function getEligibleSoldObservations(observations: MarketObservation[]) {
  return observations.filter(
    (
      observation,
    ): observation is MarketObservation & {
      soldAt: string;
      soldPriceMinor: number;
    } =>
      observation.status === "sold" &&
      observation.soldAt !== undefined &&
      observation.soldPriceMinor !== undefined &&
      observation.exclusionReasons.length === 0,
  );
}

function robustStatistics(values: number[]): RobustSegmentStatistics {
  if (values.length === 0) {
    return {
      lowerFenceMinor: 0,
      medianMinor: 0,
      sampleCount: 0,
      upperFenceMinor: 0,
    };
  }

  const center = median(values);
  const medianAbsoluteDeviation = median(values.map((value) => Math.abs(value - center)));
  const interquartileRange = quantile(values, 0.75) - quantile(values, 0.25);
  const robustScale =
    medianAbsoluteDeviation > 0
      ? medianAbsoluteDeviation * 1.4826
      : interquartileRange > 0
        ? interquartileRange / 1.349
        : Math.max(center * 0.1, 100);
  const fenceDistance = Math.max(robustScale * 4.5, center * 0.15, 100);

  return {
    lowerFenceMinor: Math.max(0, Math.floor(center - fenceDistance)),
    medianMinor: Math.round(center),
    sampleCount: values.length,
    upperFenceMinor: Math.ceil(center + fenceDistance),
  };
}

export function fitRobustOutlierPolicy(
  trainingRows: MarketObservation[],
  minimumSegmentSamples = 4,
): RobustOutlierPolicy {
  const eligible = getEligibleSoldObservations(trainingRows);
  const values = eligible.map(soldTargetMinor);
  const valuesBySegment = new Map<string, number[]>();

  for (const observation of eligible) {
    const key = segmentKey(observation);
    const segmentValues = valuesBySegment.get(key) ?? [];
    segmentValues.push(soldTargetMinor(observation));
    valuesBySegment.set(key, segmentValues);
  }

  return {
    global: robustStatistics(values),
    minSegmentSamples: minimumSegmentSamples,
    segmentKeyVersion: "brand-category-currency/v1",
    segments: Object.fromEntries(
      Array.from(valuesBySegment.entries())
        .filter(([, segmentValues]) => segmentValues.length >= minimumSegmentSamples)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, segmentValues]) => [key, robustStatistics(segmentValues)]),
    ),
  };
}

export function isRobustPriceOutlier(observation: MarketObservation, policy: RobustOutlierPolicy) {
  if (observation.status !== "sold" || observation.soldPriceMinor === undefined) {
    return false;
  }

  const statistics = policy.segments[segmentKey(observation)] ?? policy.global;

  return (
    observation.soldPriceMinor < statistics.lowerFenceMinor ||
    observation.soldPriceMinor > statistics.upperFenceMinor
  );
}

export function filterRobustPriceOutliers<T extends MarketObservation>(
  observations: T[],
  policy: RobustOutlierPolicy,
) {
  return {
    excluded: observations.filter((observation) => isRobustPriceOutlier(observation, policy)),
    included: observations.filter((observation) => !isRobustPriceOutlier(observation, policy)),
  };
}

function marketCategoricalFeatureKeys(observation: MarketObservation) {
  const keys = [
    `brand:${normalizeToken(observation.canonicalBrand)}`,
    `category:${normalizeToken(observation.category)}`,
    `source:${normalizeToken(observation.source)}`,
    `currency:${observation.normalizedCurrency}`,
    `shipping-known:${observation.shippingMinor === undefined ? "no" : "yes"}`,
  ];

  if (normalizeToken(observation.condition)) {
    keys.push(`condition:${normalizeToken(observation.condition)}`);
  }

  if (normalizeToken(observation.size)) {
    keys.push(`size:${normalizeToken(observation.size)}`);
  }

  for (const token of tokenize(observation.title).slice(0, 16)) {
    keys.push(`title:${token}`);
  }

  return keys;
}

function buildFeatureNames(trainingRows: MarketObservation[]) {
  const featureNames = new Set<string>([
    "__intercept",
    "numeric:source-confidence",
    "numeric:seller-confidence",
  ]);

  for (const row of trainingRows) {
    for (const feature of marketCategoricalFeatureKeys(row)) {
      featureNames.add(feature);
    }
  }

  return Array.from(featureNames).sort((left, right) => {
    if (left === "__intercept") {
      return -1;
    }

    if (right === "__intercept") {
      return 1;
    }

    return left.localeCompare(right);
  });
}

function marketFeatureVector(observation: MarketObservation, featureNames: string[]) {
  const categoricalFeatures = new Set(marketCategoricalFeatureKeys(observation));

  return featureNames.map((feature) => {
    if (feature === "__intercept") {
      return 1;
    }

    if (feature === "numeric:source-confidence") {
      return observation.sourceConfidence;
    }

    if (feature === "numeric:seller-confidence") {
      return observation.sellerConfidence;
    }

    if (feature.startsWith("title:")) {
      return categoricalFeatures.has(feature)
        ? 1 / Math.sqrt(Math.max(tokenize(observation.title).length, 1))
        : 0;
    }

    return categoricalFeatures.has(feature) ? 1 : 0;
  });
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index] ?? 0]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;

    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivotRow]?.[column] ?? 0)) {
        pivotRow = row;
      }
    }

    if (pivotRow !== column) {
      const temporary = augmented[column];
      augmented[column] = augmented[pivotRow] ?? [];
      augmented[pivotRow] = temporary ?? [];
    }

    const pivot = augmented[column]?.[column] ?? 0;

    if (Math.abs(pivot) < 1e-12) {
      throw new Error("Fair-value ridge system was numerically singular.");
    }

    for (let index = column; index <= size; index += 1) {
      augmented[column]![index] = (augmented[column]?.[index] ?? 0) / pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = augmented[row]?.[column] ?? 0;

      if (factor === 0) {
        continue;
      }

      for (let index = column; index <= size; index += 1) {
        augmented[row]![index] =
          (augmented[row]?.[index] ?? 0) - factor * (augmented[column]?.[index] ?? 0);
      }
    }
  }

  return augmented.map((row) => row[size] ?? 0);
}

function fitRidgeRegression(
  rows: MarketObservation[],
  featureNames: string[],
  ridgeLambda: number,
) {
  const dimension = featureNames.length;
  const gram = Array.from({ length: dimension }, () => Array.from({ length: dimension }, () => 0));
  const targetProjection = Array.from({ length: dimension }, () => 0);

  for (const row of rows) {
    const vector = marketFeatureVector(row, featureNames);
    const target = Math.log1p(soldTargetMinor(row));

    for (let left = 0; left < dimension; left += 1) {
      targetProjection[left] = (targetProjection[left] ?? 0) + (vector[left] ?? 0) * target;

      for (let right = 0; right < dimension; right += 1) {
        gram[left]![right] =
          (gram[left]?.[right] ?? 0) + (vector[left] ?? 0) * (vector[right] ?? 0);
      }
    }
  }

  for (let index = 0; index < dimension; index += 1) {
    gram[index]![index] =
      (gram[index]?.[index] ?? 0) + (featureNames[index] === "__intercept" ? 1e-8 : ridgeLambda);
  }

  return solveLinearSystem(gram, targetProjection);
}

function rawPointPrediction(
  observation: MarketObservation,
  featureNames: string[],
  coefficients: number[],
) {
  const vector = marketFeatureVector(observation, featureNames);
  const logPrediction = vector.reduce(
    (sum, value, index) => sum + value * (coefficients[index] ?? 0),
    0,
  );

  return Math.round(clamp(Math.expm1(logPrediction), 0, 100_000_000));
}

function projectTrainingRow(observation: MarketObservation) {
  return {
    canonicalBrand: observation.canonicalBrand,
    category: observation.category,
    condition: observation.condition,
    currency: observation.normalizedCurrency,
    listingId: observation.listingId,
    sellerConfidence: observation.sellerConfidence,
    shippingKnown: observation.shippingMinor !== undefined,
    size: observation.size,
    soldAt: observation.soldAt,
    soldPriceMinor: observation.soldPriceMinor,
    source: observation.source,
    sourceConfidence: observation.sourceConfidence,
    title: observation.title,
  };
}

function modelConfidence(
  artifact: FairValueArtifact,
  pointMinor: number,
  intervalHalfWidthMinor: number,
) {
  const relativeWidth = intervalHalfWidthMinor / Math.max(pointMinor, 1);

  if (
    artifact.calibrationSampleCount >= 100 &&
    artifact.calibrationCoverage >= 0.8 &&
    artifact.calibrationCoverage <= 0.98 &&
    relativeWidth <= 0.5
  ) {
    return "high" as const;
  }

  if (
    artifact.calibrationSampleCount >= 30 &&
    artifact.calibrationCoverage >= 0.7 &&
    relativeWidth <= 0.8
  ) {
    return "medium" as const;
  }

  return "low" as const;
}

export function trainFairValueModel(input: TrainFairValueInput): FairValueArtifact {
  const config = {
    ...defaultFairValueTrainingConfig,
    ...input.config,
  };
  const preparedObservations = prepareMarketObservations(input.snapshot);
  const soldRows = getEligibleSoldObservations(preparedObservations);
  const split = createTemporalSplit(
    soldRows,
    (observation) => observation.soldAt,
    input.snapshot.splitBoundaries,
  );
  assertTemporalIsolation(
    split,
    (observation) => observation.soldAt,
    (observation) => observation.observationId,
  );
  const outlierPolicy = fitRobustOutlierPolicy(split.train);
  const trainRows = filterRobustPriceOutliers(
    getEligibleSoldObservations(split.train),
    outlierPolicy,
  ).included;
  const validationRows = filterRobustPriceOutliers(
    getEligibleSoldObservations(split.validation),
    outlierPolicy,
  ).included;

  if (trainRows.length < config.minimumTrainingSamples) {
    throw new Error(
      `Fair-value training requires at least ${config.minimumTrainingSamples} eligible sold rows; received ${trainRows.length}.`,
    );
  }

  if (validationRows.length === 0) {
    throw new Error("Fair-value interval calibration requires validation sold rows.");
  }

  const featureNames = buildFeatureNames(trainRows);
  const coefficients = fitRidgeRegression(trainRows, featureNames, config.ridgeLambda);
  const residuals = validationRows.map((row) =>
    Math.abs(soldTargetMinor(row) - rawPointPrediction(row, featureNames, coefficients)),
  );
  const fallbackTrainingResiduals = trainRows.map((row) =>
    Math.abs(soldTargetMinor(row) - rawPointPrediction(row, featureNames, coefficients)),
  );
  const globalIntervalHalfWidthMinor = Math.max(
    100,
    Math.round(
      quantile(
        residuals.length >= 3 ? residuals : [...residuals, ...fallbackTrainingResiduals],
        0.9,
      ),
    ),
  );
  const residualsBySegment = new Map<string, number[]>();

  for (let index = 0; index < validationRows.length; index += 1) {
    const row = validationRows[index];
    const residual = residuals[index];

    if (!row || residual === undefined) {
      continue;
    }

    const key = segmentKey(row);
    const segmentResiduals = residualsBySegment.get(key) ?? [];
    segmentResiduals.push(residual);
    residualsBySegment.set(key, segmentResiduals);
  }

  const segmentIntervalHalfWidths = Object.fromEntries(
    Array.from(residualsBySegment.entries())
      .filter(
        ([, segmentResiduals]) =>
          segmentResiduals.length >= config.minimumSegmentCalibrationSamples,
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, segmentResiduals]) => [
        key,
        Math.max(100, Math.round(quantile(segmentResiduals, 0.9))),
      ]),
  );
  const covered = validationRows.filter((row) => {
    const point = rawPointPrediction(row, featureNames, coefficients);
    const halfWidth = segmentIntervalHalfWidths[segmentKey(row)] ?? globalIntervalHalfWidthMinor;
    const target = soldTargetMinor(row);
    return target >= point - halfWidth && target <= point + halfWidth;
  }).length;
  const trainingWindowEnd = trainRows
    .map((row) => row.soldAt ?? "")
    .sort()
    .at(-1);
  const validationWindowEnd = validationRows
    .map((row) => row.soldAt ?? "")
    .sort()
    .at(-1);

  if (!trainingWindowEnd || !validationWindowEnd) {
    throw new Error("Fair-value temporal windows could not be derived.");
  }

  const fingerprintPayload = {
    calibration: validationRows.map(projectTrainingRow),
    config,
    features: featureNames,
    schema: MARKET_FEATURE_SCHEMA_VERSION,
    training: trainRows.map(projectTrainingRow),
  };
  const dataFingerprint = stableFingerprint(fingerprintPayload);

  return {
    calibrationCoverage: roundMetric(covered / validationRows.length),
    calibrationSampleCount: validationRows.length,
    coefficients: coefficients.map((coefficient) => roundMetric(coefficient, 12)),
    featureNames,
    globalIntervalHalfWidthMinor,
    metadata: {
      artifactId: `fair-value-${FAIR_VALUE_MODEL_VERSION.replaceAll("/", "-")}-${dataFingerprint}`,
      dataFingerprint,
      featureSchemaVersion: MARKET_FEATURE_SCHEMA_VERSION,
      modelKind: "fair_value",
      modelVersion: FAIR_VALUE_MODEL_VERSION,
      seed: input.snapshot.metadata.seed,
      snapshotId: input.snapshot.metadata.snapshotId,
      status: "shadow",
      trainedAt: input.snapshot.metadata.createdAt,
      trainingWindowEnd,
    },
    outlierPolicy,
    ridgeLambda: config.ridgeLambda,
    segmentIntervalHalfWidths,
    trainingProfile: {
      brandDistribution: countDistribution(trainRows.map((row) => row.canonicalBrand)),
      categoryDistribution: countDistribution(trainRows.map((row) => row.category)),
      sourceDistribution: countDistribution(trainRows.map((row) => row.source)),
    },
    validationWindowEnd,
  };
}

export function predictFairValue(
  artifact: FairValueArtifact,
  observation: MarketObservation,
): FairValuePrediction {
  const pointMinor = rawPointPrediction(observation, artifact.featureNames, artifact.coefficients);
  const intervalHalfWidthMinor =
    artifact.segmentIntervalHalfWidths[segmentKey(observation)] ??
    artifact.globalIntervalHalfWidthMinor;

  return {
    confidence: modelConfidence(artifact, pointMinor, intervalHalfWidthMinor),
    currency: observation.normalizedCurrency,
    highMinor: Math.max(pointMinor, pointMinor + intervalHalfWidthMinor),
    lowMinor: Math.max(0, pointMinor - intervalHalfWidthMinor),
    modelVersion: artifact.metadata.modelVersion,
    pointMinor,
  };
}

function jaccardSimilarity(left: string, right: string) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  const union = new Set([...leftTokens, ...rightTokens]);

  if (union.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

export function selectComparableListings(
  target: MarketObservation,
  observations: MarketObservation[],
  asOf: string,
  limit = 50,
): ComparableListing[] {
  const asOfTimestamp = toTimestamp(asOf, "comparable asOf");

  return getEligibleSoldObservations(observations)
    .filter(
      (observation) =>
        observation.listingId !== target.listingId &&
        normalizeToken(observation.canonicalBrand) === normalizeToken(target.canonicalBrand) &&
        normalizeToken(observation.category) === normalizeToken(target.category) &&
        observation.normalizedCurrency === target.normalizedCurrency &&
        toTimestamp(observation.soldAt, "comparable soldAt") < asOfTimestamp,
    )
    .map((observation) => {
      const conditionMatch =
        normalizeToken(observation.condition) === normalizeToken(target.condition);
      const sizeMatch = normalizeToken(observation.size) === normalizeToken(target.size);
      const textSimilarity = jaccardSimilarity(observation.title, target.title);
      const recency = clamp(1 - daysBetween(observation.soldAt, asOf) / 365, 0, 1);

      return {
        observation,
        similarity:
          Number(conditionMatch) * 3 + Number(sizeMatch) * 2 + textSimilarity * 2 + recency,
      };
    })
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        (right.observation.soldAt ?? "").localeCompare(left.observation.soldAt ?? "") ||
        left.observation.observationId.localeCompare(right.observation.observationId),
    )
    .slice(0, limit);
}

export function buildObservedRange(
  comparables: ComparableListing[],
  currency: string,
): ObservedRange | undefined {
  const values = comparables.map(({ observation }) => soldTargetMinor(observation));

  if (values.length === 0) {
    return undefined;
  }

  const robust = robustStatistics(values);
  const filtered = values.filter(
    (value) => value >= robust.lowerFenceMinor && value <= robust.upperFenceMinor,
  );
  const rangeValues = filtered.length > 0 ? filtered : values;

  return {
    comparableCount: rangeValues.length,
    currency,
    highMinor: Math.round(quantile(rangeValues, 0.75)),
    lowMinor: Math.round(quantile(rangeValues, 0.25)),
    medianMinor: Math.round(median(rangeValues)),
  };
}

export function detectFairValueDrift(
  artifact: FairValueArtifact,
  currentRows: MarketObservation[],
  now: string,
  inputConfig: Partial<MarketDriftConfig> = {},
): DriftReport {
  const config = {
    ...defaultDriftConfig,
    ...inputConfig,
  };
  const brandDistribution = countDistribution(currentRows.map((row) => row.canonicalBrand));
  const categoryDistribution = countDistribution(currentRows.map((row) => row.category));
  const sourceDistribution = countDistribution(currentRows.map((row) => row.source));
  const distances = [
    totalVariationDistance(artifact.trainingProfile.brandDistribution, brandDistribution),
    totalVariationDistance(artifact.trainingProfile.categoryDistribution, categoryDistribution),
    totalVariationDistance(artifact.trainingProfile.sourceDistribution, sourceDistribution),
  ];
  const maxDistributionDistance = Math.max(0, ...distances);
  const trainingCategoricalFeatures = new Set(
    artifact.featureNames.filter(
      (feature) =>
        feature.startsWith("brand:") ||
        feature.startsWith("category:") ||
        feature.startsWith("source:"),
    ),
  );
  const categoricalFeatures = currentRows.flatMap((row) =>
    marketCategoricalFeatureKeys(row).filter(
      (feature) =>
        feature.startsWith("brand:") ||
        feature.startsWith("category:") ||
        feature.startsWith("source:"),
    ),
  );
  const unseenCategoricalRate =
    categoricalFeatures.filter((feature) => !trainingCategoricalFeatures.has(feature)).length /
    Math.max(categoricalFeatures.length, 1);
  const stale = daysBetween(artifact.metadata.trainedAt, now) > config.maximumAgeDays;
  const reasons: string[] = [];

  if (stale) {
    reasons.push("model_stale");
  }

  if (maxDistributionDistance > config.maximumDistributionDistance) {
    reasons.push("categorical_distribution_drift");
  }

  if (unseenCategoricalRate > config.maximumUnseenCategoricalRate) {
    reasons.push("unseen_categorical_rate");
  }

  return {
    drifted: reasons.some((reason) => reason !== "model_stale"),
    maxDistributionDistance: roundMetric(maxDistributionDistance),
    reasons,
    stale,
    unseenCategoricalRate: roundMetric(unseenCategoricalRate),
  };
}

export function estimateMarketValue(input: MarketEstimateInput): MarketEstimate {
  const minimumComparables = input.minimumComparables ?? 4;
  const minimumCalibrationSamples =
    input.minimumModelCalibrationSamples ??
    defaultFairValueTrainingConfig.minimumCalibrationSamplesForModelUse;
  const comparableCandidates = selectComparableListings(
    input.target,
    input.observations,
    input.asOf,
  ).filter(({ observation }) => !isRobustPriceOutlier(observation, input.artifact.outlierPolicy));
  const observedRange = buildObservedRange(comparableCandidates, input.target.normalizedCurrency);
  const dataFreshnessAt = comparableCandidates
    .map(({ observation }) => observation.observedAt)
    .sort()
    .at(-1);
  const base = {
    comparableCount: observedRange?.comparableCount ?? 0,
    currency: input.target.normalizedCurrency,
    dataFreshnessAt,
    disclaimer:
      "Estimate is based on observed comparable listings, is not financial advice, and is not a prediction of future value.",
  };

  if (!observedRange || observedRange.comparableCount < minimumComparables) {
    return {
      ...base,
      reasonCodes: ["minimum_comparable_sample_not_met"],
      status: "limited_data",
      wording: "Limited data",
    };
  }

  const prediction = predictFairValue(input.artifact, input.target);
  const reasonCodes: string[] = [];

  if (input.artifact.metadata.status !== "promoted" && !input.allowShadowModel) {
    reasonCodes.push("model_not_promoted");
  }

  if (input.artifact.calibrationSampleCount < minimumCalibrationSamples) {
    reasonCodes.push("insufficient_model_calibration");
  }

  if (prediction.confidence === "low") {
    reasonCodes.push("model_confidence_low");
  }

  if (input.drift?.stale) {
    reasonCodes.push("model_stale");
  }

  if (input.drift?.drifted) {
    reasonCodes.push("model_drift_detected");
  }

  if (reasonCodes.length > 0) {
    return {
      ...base,
      modelVersion: input.artifact.metadata.modelVersion,
      observedRange,
      reasonCodes,
      status: "observed_range",
      wording: "Based on observed comparable listings",
    };
  }

  return {
    ...base,
    estimate: prediction,
    modelVersion: input.artifact.metadata.modelVersion,
    observedRange,
    reasonCodes: ["model_confidence_adequate"],
    status: "model_estimate",
    wording: "Estimated range",
  };
}
