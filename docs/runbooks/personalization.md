# Personalization and Recommendation Runtime

## Active behavior

The explainable rules ranker is the authoritative default and failure/cold-start
fallback. The hybrid ML candidate is available through a guarded runtime but is
not promoted.

## Durable inputs

Production profiles can use:

- onboarding brand/category/price preferences
- normalized liked listings
- searches and filter applications
- saved searches and saved filters
- enabled watchlists as weaker intent
- preferred sources/settings
- clicks/opens, qualified views, likes/unlikes, saves, hides, and recommendation
  events from PostgreSQL daily aggregates
- listing content, quality, freshness, popularity, source, and exact
  same-currency price bands

A server response is not an impression. The web emits `listing_view` only after
50% visibility for one second, with a unique event ID and opaque privacy
session. Worker rollups keep feed requests from scanning raw events.

## Rules baseline

Rules apply inspectable affinity, intent, price, freshness, quality, and durable
engagement boosts. Selection penalizes repeated brands/categories/sources and
near-identical signatures while retaining an exploration lane.

Cold start:

- signed-out or signal-free users receive generic deterministic results
- onboarding preferences provide content boosts without interaction history
- sparse-history users retain content/popularity/freshness behavior

Development debug metadata includes reason codes and score breakdowns, not
credentials or full sensitive user features.

## ML candidate

`packages/ml` trains a deterministic implicit/content hybrid:

- versioned recommendation feature schema
- fixed seed and snapshot fingerprint
- temporal train/validation/test isolation
- weighted implicit user content profile and item co-occurrence
- explicit preference/content cold start
- popularity and freshness
- provider/brand diversity quotas and repeat penalties
- Recall@K, NDCG@K, MAP@K, coverage, diversity, novelty, provider
  concentration, brand concentration, and cold-start metrics

The API adapter consumes an immutable JSON artifact. It does not train or write
artifacts in requests.

## Rollout modes

- `disabled` (default): return rules immediately
- `shadow`: validate/score ML, return rules, and attach bounded overlap/reason
  metadata
- `active`: permitted only with an artifact lifecycle of `promoted`, explicit
  promotion approval, compatible schema/model version, and non-stale artifact

Safety:

- maximum 500 candidates
- 1–250 ms configured timeout, 25 ms default
- malformed, missing, oversized, incompatible, stale, retired, timed-out, or
  failed artifacts fall back to rules
- price-band features are skipped unless candidates share a normalized
  comparison currency
- per-item responses include reason codes/rank, not raw feature values or user
  weights

## Current evaluation

Synthetic fixture at K=5:

| Metric       |  Rules | Hybrid |
| ------------ | -----: | -----: |
| Recall       | 0.0000 | 0.8750 |
| NDCG         | 0.0000 | 0.7577 |
| MAP          | 0.0000 | 0.7188 |
| Coverage     | 0.3889 | 0.9444 |
| Diversity    | 0.8938 | 0.8375 |
| Provider HHI | 0.3350 | 0.3400 |
| Brand HHI    | 0.2250 | 0.1763 |

This is not production evidence: only eight synthetic users and one snapshot
were evaluated, and diversity regressed more than the allowed `0.02`. The
artifact lifecycle is `shadow`, so active mode rejects it.

## Promotion

At minimum:

- 100 evaluated users and three reproducible temporal snapshots
- NDCG improvement `>= +0.02`
- Recall no worse than `-0.005`
- diversity no worse than baseline `-0.02`
- coverage at least 95% of baseline
- provider/brand concentration no worse than baseline `+0.03`
- cold-start NDCG no worse than baseline `-0.02`
- inference p95 at most 75 ms
- privacy and segment/concentration review

## Operations and rollback

Metrics expose request/fallback counts, structured fallback reason, last
inference time, selected strategy, and non-secret model version. Observe shadow
overlap, latency, diversity, and concentration before promotion.

Rollback is configuration to `shadow` or `disabled` plus artifact retirement.
No schema rollback is required; rules remain independently available.

See [ML status](../ml/README.md) and the
[recommendation model card](../ml/recommendation-model-card.md).
