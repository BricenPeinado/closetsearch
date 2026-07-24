# Recommendation Model Card

## Model

- Version: `implicit-content-hybrid/v1`
- Feature schema: `recommendation-features/v1`
- Lifecycle: `shadow`
- Seed: stored per snapshot/artifact; fixture seed is `20260724`

The model creates a user content profile from weighted implicit events and learns normalized item co-occurrence from positive interactions. Candidate scores combine content affinity, item co-occurrence, explicit preferences, popularity, and freshness. A greedy reranker applies brand/source quotas and repeat penalties.

Users with fewer than two positive-weight interaction units use a content-based cold-start path built from explicit preferences, price bounds, popularity, and freshness.

## Intended use

Rank normalized active ClosetSearch discovery candidates in offline evaluation and shadow traffic. Per-item output includes bounded reason codes and contribution weights. It must not expose raw user feature vectors.

## Not intended

- replacing explicit search ordering
- inferring sensitive attributes
- authenticity, investment, profit, or future-value claims
- training directly on process-local response counts
- operating without the existing rules baseline and timeout fallback

## Runtime safety

The package-level experiment helper defaults to `shadow`; the deployed API
adapter defaults to the safer `disabled` mode until an artifact path and
rollout flag are explicitly configured. Shadow mode computes an ML ranking but
returns the caller-supplied rules ranking. `disabled` returns rules
immediately. `active` requires both an explicitly approved deployment and an
artifact whose lifecycle status is `promoted`. Schema/version mismatch,
artifact staleness, timeout, or inference errors return rules with a structured
fallback reason. The API exposes reason codes but not raw feature vectors or
user weights.

The API adapter independently validates the serialized artifact boundary before
inference so a package/runtime version mismatch fails closed. It bounds a
request to 500 candidates and 1–250 ms, applies provider/brand dominance
safeguards, and skips price-band affinity whenever candidates do not share one
normalized comparison currency.

## Evaluation and promotion

Metrics are Recall@K, NDCG@K, MAP@K, catalog coverage, intra-list diversity, novelty, provider concentration, and brand concentration, with separate cold-start reporting.

Promotion requires, at minimum:

- 100 evaluated users and three reproducible temporal snapshots
- NDCG@K improvement of at least `+0.02`
- Recall@K no worse than `-0.005`
- diversity no worse than baseline minus `0.02`
- coverage at least 95% of baseline
- provider and brand concentration no worse than baseline plus `0.03`
- cold-start NDCG no worse than baseline minus `0.02`
- inference p95 at or below 75 ms

The fixture result is not promotion evidence: it has only 8 evaluated users, 2 cold-start users, and one synthetic snapshot. Rules remain active.

## Limitations

The dependency-light co-occurrence model cannot learn rich latent semantics, and title tokenization is intentionally simple. The fixture is too small and constructed to demonstrate behavior, so its ranking improvements do not estimate production impact. Popularity and historical engagement can reproduce exposure bias; concentration and segment review are mandatory.
