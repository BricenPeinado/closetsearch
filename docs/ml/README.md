# ML Status and Operations

ClosetSearch now has a reproducible ML experimentation boundary in `packages/ml`. This is an internal foundation, not a production model launch.

| Capability | Status | Active production behavior |
| --- | --- | --- |
| Hybrid recommendations | Shadow-ready, fixture-tested | Existing explainable rules ranker remains authoritative |
| Cold-start content ranking | Implemented | Available to shadow evaluation; rules fallback remains active |
| Brand/source diversity reranking | Implemented | Available inside the shadow candidate |
| Fair-value model | Shadow-ready, fixture-tested | Robust observed comparable range only |
| Uncertainty intervals | Implemented but poorly calibrated on fixture | Not eligible for user-facing model estimates |
| Drift/staleness checks | Implemented | Any detected issue forces observed-range fallback |
| Model promotion | Executable gates implemented | Blocked by insufficient production data and failed fixture gates |

## Documents

- [Recommendation model card](recommendation-model-card.md)
- [Fair-value model card](fair-value-model-card.md)
- [Dataset card](dataset-card.md)
- [Fixture evaluation evidence](evaluation-fixture-v1.md)

## Production activation sequence

1. Build privacy-reviewed, deletion-aware production feature snapshots from durable engagement and normalized listing history.
2. Require at least three non-overlapping temporal snapshots.
3. Verify schema versions and leakage checks before training.
4. Train reproducibly and persist the immutable artifact, data fingerprint, feature schema, seed, and evaluation report.
5. Pass recommendation or fair-value promotion gates, including sample size, quality, diversity/concentration or interval coverage, drift, and latency.
6. Run recommendation shadow traffic without changing chosen rankings. Do not expose sensitive features in logs or debug responses.
7. Review segment outcomes and provider/brand concentration for harm and data-quality regressions.
8. Promote behind a reversible feature flag only after explicit approval. Keep rules/observed-range fallbacks enabled.

Rollback is a feature-flag change to `disabled`/`shadow` plus artifact retirement. No database rollback is needed because artifacts are immutable and the existing product behavior remains the fallback.
