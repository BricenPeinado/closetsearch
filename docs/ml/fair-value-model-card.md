# Fair-Value Model Card

## Model

- Version: `ridge-log-price/v1`
- Feature schema: `market-fair-value-features/v1`
- Lifecycle: `shadow`
- Target: confirmed normalized `soldPriceMinor`

The model is a deterministic ridge regression over log sold price. Inputs include canonical brand/category, condition, size, source, normalized currency, title tokens, source metadata confidence, seller metadata confidence, and whether shipping is known. Seller confidence is a data-completeness signal, not authenticity analysis.

Active asking price is explicitly prohibited from the feature vector and target. Tests change every asking price by a large amount and require the trained artifact and predictions to remain identical.

## Dataset safeguards

- deterministic deduplication by source/listing key
- exact integer minor units and explicit currencies
- confirmed sold rows only for training/evaluation targets
- train-fitted median/MAD robust outlier fences, with IQR fallback
- minimum train and comparable sample gates
- temporal train/calibration/test isolation
- segment evaluation by brand, category, and source

Validation residuals calibrate a 90th-percentile symmetric interval. Production use additionally requires adequate calibration count and empirical coverage.

## User-facing behavior

The estimator may return only:

- `Estimated range`
- `Based on observed comparable listings`
- `Limited data`

It carries comparable count, currency, freshness, model version when applicable, and a disclaimer. Unpromoted, under-calibrated, low-confidence, stale, or drifted models fall back to an observed interquartile range. Too few comparable sold rows return limited data.

It must never produce guaranteed profit, guaranteed underpriced, investment, authenticity, or certain future-value language.

## Drift and staleness

The artifact stores training brand/category/source distributions. Runtime checks total-variation distance, unseen categorical rate, and model age. Default thresholds are 0.25 distribution distance, 0.20 unseen categorical rate, and 45 days. Any breach blocks model estimates.

## Promotion requirements

The executable gate requires at least 100 temporal test rows, three reproducible snapshots, at least 2% MAE improvement over the observed-median baseline, non-degraded median absolute error, empirical interval coverage from 0.80 through 0.98, and no stale/drift condition.

The fixture candidate fails quality and calibration: it has six test sales, worse MAE/median error than baseline, and 0.1667 interval coverage. It is not promoted; observed ranges remain active.
