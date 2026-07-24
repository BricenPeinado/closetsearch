import { mean, median, roundMetric } from "./deterministic.js";
import {
  buildObservedRange,
  filterRobustPriceOutliers,
  getEligibleSoldObservations,
  predictFairValue,
  selectComparableListings,
} from "./market.js";
import type {
  FairValueArtifact,
  MarketEvaluation,
  MarketEvaluationMetrics,
  MarketObservation,
  MarketSegmentEvaluation,
  PromotionCheck,
  PromotionDecision,
} from "./types.js";

interface EvaluatedPrediction {
  absoluteErrorMinor: number;
  brand: string;
  category: string;
  covered: boolean;
  percentageError?: number;
  source: string;
}

export interface FairValuePromotionGateInput {
  baseline: MarketEvaluationMetrics;
  candidate: MarketEvaluationMetrics;
  drifted: boolean;
  minimumTestSamples?: number;
  reproducibleSnapshots: number;
  stale: boolean;
}

function metricsFromPredictions(
  predictions: EvaluatedPrediction[],
): MarketEvaluationMetrics {
  const eligibleMape = predictions
    .map((prediction) => prediction.percentageError)
    .filter((value): value is number => value !== undefined);

  return {
    intervalCoverage: roundMetric(
      predictions.filter((prediction) => prediction.covered).length /
        Math.max(predictions.length, 1),
    ),
    maeMinor: roundMetric(
      mean(predictions.map((prediction) => prediction.absoluteErrorMinor)),
      2,
    ),
    mapeEligibleCount: eligibleMape.length,
    mapePercent:
      eligibleMape.length > 0
        ? roundMetric(mean(eligibleMape) * 100, 3)
        : undefined,
    medianAbsoluteErrorMinor: roundMetric(
      median(predictions.map((prediction) => prediction.absoluteErrorMinor)),
      2,
    ),
    sampleCount: predictions.length,
  };
}

function segmentEvaluation(
  predictions: EvaluatedPrediction[],
  getSegment: (prediction: EvaluatedPrediction) => string,
): MarketSegmentEvaluation[] {
  const predictionsBySegment = new Map<string, EvaluatedPrediction[]>();

  for (const prediction of predictions) {
    const segment = getSegment(prediction);
    const rows = predictionsBySegment.get(segment) ?? [];
    rows.push(prediction);
    predictionsBySegment.set(segment, rows);
  }

  return Array.from(predictionsBySegment.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([segment, segmentPredictions]) => ({
      metrics: metricsFromPredictions(segmentPredictions),
      segment,
    }));
}

function buildEvaluation(predictions: EvaluatedPrediction[]): MarketEvaluation {
  return {
    byBrand: segmentEvaluation(predictions, (prediction) => prediction.brand),
    byCategory: segmentEvaluation(predictions, (prediction) => prediction.category),
    bySource: segmentEvaluation(predictions, (prediction) => prediction.source),
    overall: metricsFromPredictions(predictions),
  };
}

export function evaluateFairValueModel(
  artifact: FairValueArtifact,
  testRows: MarketObservation[],
  minimumMapeTargetMinor = 1_000,
): MarketEvaluation {
  const eligible = filterRobustPriceOutliers(
    getEligibleSoldObservations(testRows),
    artifact.outlierPolicy,
  ).included;

  for (const row of eligible) {
    if ((row.soldAt ?? "") <= artifact.validationWindowEnd) {
      throw new Error(
        `Fair-value evaluation leakage: ${row.observationId} is not after the calibration window.`,
      );
    }
  }

  const predictions = eligible.map((row): EvaluatedPrediction => {
    const prediction = predictFairValue(artifact, row);
    const target = row.soldPriceMinor;
    const absoluteErrorMinor = Math.abs(target - prediction.pointMinor);

    return {
      absoluteErrorMinor,
      brand: row.canonicalBrand,
      category: row.category,
      covered:
        target >= prediction.lowMinor && target <= prediction.highMinor,
      percentageError:
        target >= minimumMapeTargetMinor
          ? absoluteErrorMinor / target
          : undefined,
      source: row.source,
    };
  });

  return buildEvaluation(predictions);
}

export function evaluateObservedMedianBaseline(
  history: MarketObservation[],
  testRows: MarketObservation[],
  minimumMapeTargetMinor = 1_000,
): MarketEvaluation {
  const predictions: EvaluatedPrediction[] = [];

  for (const row of getEligibleSoldObservations(testRows)) {
    const comparables = selectComparableListings(row, history, row.soldAt);
    const observedRange = buildObservedRange(
      comparables,
      row.normalizedCurrency,
    );

    if (!observedRange || observedRange.comparableCount < 4) {
      continue;
    }

    const target = row.soldPriceMinor;
    const absoluteErrorMinor = Math.abs(target - observedRange.medianMinor);
    predictions.push({
      absoluteErrorMinor,
      brand: row.canonicalBrand,
      category: row.category,
      covered:
        target >= observedRange.lowMinor && target <= observedRange.highMinor,
      percentageError:
        target >= minimumMapeTargetMinor
          ? absoluteErrorMinor / target
          : undefined,
      source: row.source,
    });
  }

  return buildEvaluation(predictions);
}

function promotionCheck(
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

export function evaluateFairValuePromotion(
  input: FairValuePromotionGateInput,
): PromotionDecision {
  const minimumTestSamples = input.minimumTestSamples ?? 100;
  const checks = [
    promotionCheck(
      "temporal_test_samples",
      input.candidate.sampleCount,
      input.candidate.sampleCount >= minimumTestSamples,
      `>= ${minimumTestSamples}`,
    ),
    promotionCheck(
      "reproducible_temporal_snapshots",
      input.reproducibleSnapshots,
      input.reproducibleSnapshots >= 3,
      ">= 3",
    ),
    promotionCheck(
      "mae_improvement",
      input.baseline.maeMinor - input.candidate.maeMinor,
      input.candidate.maeMinor <= input.baseline.maeMinor * 0.98,
      "candidate <= 98% of observed-median baseline",
    ),
    promotionCheck(
      "median_absolute_error_non_degradation",
      input.baseline.medianAbsoluteErrorMinor -
        input.candidate.medianAbsoluteErrorMinor,
      input.candidate.medianAbsoluteErrorMinor <=
        input.baseline.medianAbsoluteErrorMinor,
      "candidate <= baseline",
    ),
    promotionCheck(
      "interval_coverage_lower_bound",
      input.candidate.intervalCoverage,
      input.candidate.intervalCoverage >= 0.8,
      ">= 0.80",
    ),
    promotionCheck(
      "interval_coverage_upper_bound",
      input.candidate.intervalCoverage,
      input.candidate.intervalCoverage <= 0.98,
      "<= 0.98",
    ),
    promotionCheck(
      "model_not_stale",
      Number(input.stale),
      !input.stale,
      "false",
    ),
    promotionCheck(
      "model_not_drifted",
      Number(input.drifted),
      !input.drifted,
      "false",
    ),
  ];
  const failed = checks.filter((check) => !check.passed);

  return {
    approved: failed.length === 0,
    checks,
    reasons: failed.map(
      (check) => `${check.name} was ${check.actual}; required ${check.required}.`,
    ),
  };
}
