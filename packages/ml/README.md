# ClosetSearch ML

`@closetsearch/ml` is the dependency-light, offline training/evaluation boundary
for recommendation and fair-value experiments. It does not make network calls,
read production databases, or remove the API's rules/observed fallbacks. The
guarded online adapter lives in `apps/api`.

## Current runtime status

- Recommendation artifact: lifecycle **shadow**. The API supports
  disabled/shadow/guarded-active modes, but active requires an immutable promoted
  artifact and explicit deployment approval. Shadow returns the rules ranking to
  users and records bounded comparison metadata.
- Fair-value artifact: **unpromoted**. `estimateMarketValue` returns robust
  observed comparable ranges while the artifact is unpromoted,
  under-calibrated, stale, drifted, or low confidence.
- Training data: versioned synthetic recorded fixtures only. Fixture provider
  names are diversity-test labels, not live inventory or authorization evidence.
- Production promotion: blocked until multiple temporal production snapshots,
  adequate users/sold samples, latency evidence, privacy review, and every
  executable promotion gate pass.

## Boundaries

The package contains:

- explicit recommendation and market feature schemas
- deterministic snapshot fingerprints and artifact ids
- fixed-seed training
- temporal train/validation/test splitting and leakage checks
- implicit-feedback/content recommendation with cold-start preferences
- conservative brand/source diversity reranking
- ranking and market offline evaluation
- robust sold-comparable selection, outlier handling, uncertainty, drift checks, and observed-range fallback

The package intentionally does not contain:

- provider raw payloads or network clients
- database queries
- API or web integration
- HTTP routing, artifact deployment, or online feature lookup (owned by the API
  adapter)
- billing or entitlement logic
- authenticity/fake-risk predictions

## Commands

Run from the repository root:

```sh
corepack pnpm --filter @closetsearch/ml typecheck
corepack pnpm --filter @closetsearch/ml build
corepack pnpm --filter @closetsearch/ml lint
corepack pnpm --filter @closetsearch/ml test
corepack pnpm --filter @closetsearch/ml test:smoke
corepack pnpm --filter @closetsearch/ml evaluate
```

## Integration contract

Recommendation callers provide normalized active candidates, a user ID,
optional non-sensitive preferences, a strict timeout, and the existing rules
ranker as `baselineRanker`. Production may begin only in `shadow` mode until
promotion gates pass. A result includes the model version, chosen ranking,
optional shadow ranking, and fallback reason.

Market callers provide exact minor-unit prices, normalized currencies with rate
provenance upstream, confirmed sold outcomes, and an `asOf` timestamp.
`askingPriceMinor` is retained for dataset audits but is prohibited from model
features and targets.

See [`docs/ml`](../../docs/ml/README.md) for dataset cards, model cards, fixture evaluation, and activation gates.
