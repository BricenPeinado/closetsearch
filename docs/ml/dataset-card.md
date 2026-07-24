# ML Dataset Card

## Versioned schemas

- Recommendation feature schema: `recommendation-features/v1`
- Market feature schema: `market-fair-value-features/v1`
- Fixture snapshots:
  - `packages/ml/fixtures/recommendation-snapshot.v1.json`
  - `packages/ml/fixtures/market-snapshot.v1.json`

Each snapshot records a snapshot id, schema version, deterministic seed, creation timestamp, synthetic/production marker, and explicit temporal cutoffs. Artifacts record the source snapshot id, feature schema, model version, seed, training-window end, and a stable data fingerprint.

## Recommendation data

Candidate content fields are canonical brand/category, size, condition, exact minor-unit price band, source, title tokens, and availability timestamp. User signals are durable viewport, click, like, save, watchlist, and hide events plus explicit onboarding/search preferences.

Viewport events should only enter a future production snapshot after the listing met the product's minimum visible duration. Event ids must be deduplicated upstream. Raw session tokens, email addresses, IP addresses, auth secrets, and free-form sensitive profile data are prohibited.

The fixture contains 18 synthetic listings, 27 events, and 8 synthetic users. Marketplace-like source names end in `-fixture`; they do not represent live or authorized inventory.

## Market data

Rows retain canonical brand/category, title, condition, size, source, listing/sold timestamps, original and normalized currency, asking price, confirmed sold price when known, shipping, metadata confidence, exchange-rate provenance when conversion occurred, deduplication key, and exclusion reasons.

Critical target boundary:

- confirmed `soldPriceMinor` is the only training target
- active asking price is neither a target nor a feature
- asking and sold values remain distinct for audits
- non-sold rows cannot carry realized sold targets
- currency values must be explicit; no cross-currency comparison occurs here

The fixture has three synthetic brand/category segments, chronological train/calibration/test sold rows, active inference examples with deliberately extreme asking prices, one duplicate, one excluded conversion row, and one deliberate sold-price outlier.

## Splitting and leakage

Both pipelines use global timestamp cutoffs with train end-exclusive and validation end-exclusive boundaries. Rows sharing a timestamp cannot be split by row order. Validation rejects partition overlap, duplicate identities across partitions, empty partitions, invalid timestamps, schema mismatches, and recommendation events referencing unknown listings.

Recommendation profiles and popularity are fit from train events only. Fair-value coefficients and outlier thresholds use train sold rows only; validation sold rows calibrate intervals; test sold rows are strictly after calibration.

## Privacy, retention, and deletion

Production snapshots must use pseudonymous user ids, document lawful purpose, and follow the product's engagement-event retention/deletion policy. A user deletion must prevent their events from entering new snapshots; previously built artifacts require a documented retraining/deletion policy based on the applicable privacy commitment. Snapshot storage must be access-controlled and must never contain auth credentials or provider secrets.
