# Market Analytics

## Product boundary

Analytics are entitlement-gated observed pricing context. They are not financial
advice, a purchase recommendation, a guaranteed bargain/profit claim, an
authenticity verdict, or a prediction of future value.

Allowed wording includes:

- estimated/observed range
- based on observed comparable listings
- below/within/above observed range
- limited data
- model confidence is low

## Durable observation source

Provider ingestion runs in the separate PostgreSQL worker. Feed/search traffic
is no longer the only source of history.

For every eligible normalized observation:

- exact original amount/currency is retained
- optional comparison rate/source/timestamp is retained
- asking and confirmed sold price remain distinct
- lifecycle state is retained rather than deleting history
- duplicate ingestion event IDs are idempotent
- a changed amount/currency/status creates a new price observation
- `observation_version` provides monotonic latest/history order

SQLite local/test mode still records best-effort traffic observations for
compatibility, but production analytics read PostgreSQL.

## Current observed analytics

Latest observations are selected by maximum monotonic version for each listing,
not by timestamp. Ineligible observations and listings whose current lifecycle
is stale, removed, or unavailable are excluded.

Overview reports:

- observed listing, brand, and category counts
- asking and confirmed-sold comparable counts separately
- source coverage
- latest observation time
- minimum-sample/data-quality state
- cautious asking-price signal count

Market insights choose comparables independently for each brand/category and
currency segment. A segment uses confirmed sold rows when it has them and
otherwise uses explicitly labeled observed asking rows. The response reports
`basis=confirmed_sold`, `basis=asking_fallback`, or
`basis=segment_sold_first`; each summary also reports its own
`confirmed_sold`/`observed_asking` basis. Asking-only segments therefore remain
visible when an unrelated segment has sold data. Brand/category summaries never
mix currencies.

The legacy `/analytics/underpriced` route is retained for contract compatibility,
but its output is labeled observed asking comparison and states that it does not
imply profit or guaranteed value.

## Comparables and sample gates

Observed ranges use latest eligible normalized observations, grouped by
currency. Comparables prefer matching brand/category and can narrow by condition
or listing type when enough rows remain.

At least four same-currency comparables are required for a range signal. Smaller
sets return limited data. Cross-currency data is never coerced into a labeled
single-currency range or numerically ordered against another currency.

## Fair-value candidate

The offline model:

- trains only on confirmed normalized sold price
- prohibits active asking price as a realized target or model feature
- deduplicates by provider/source listing identity
- uses temporal train/calibration/test splits
- applies train-fitted robust outlier handling
- evaluates brand/category/source segments
- returns a calibrated interval only when sample, drift, staleness, and
  confidence gates pass
- otherwise returns an observed interquartile range or limited data

Current fixture result:

- observed-median baseline MAE: `4,500` minor units
- ridge candidate MAE: `5,623`
- candidate median absolute error: `5,977`
- interval coverage: `0.1667`
- test rows: `6`

The candidate is worse than the baseline and badly under-covered. It is not
promoted and no model estimate should appear in production.

## Premium access

Analytics unlock only through an active persisted entitlement. Access is never
derived from username. The repository has no billing integration; only a
verified-admin, non-production development grant path exists.

## Freshness and drift

User-facing responses carry data freshness, comparable count, source coverage,
currency, basis, and disclaimers. The fair-value artifact stores training
distribution/model age metadata; excessive distribution distance, unseen
categories, age, low calibration, or low confidence forces observed fallback.

## Operations

Monitor:

- ingestion checkpoint age and provider coverage
- confirmed sold versus asking counts
- eligible/excluded observation count and exclusion reasons
- rate/currency staleness
- minimum-sample coverage by segment
- model artifact age, drift, confidence, interval coverage, and fallback rate

Do not promote a model or soften copy because more active asking prices arrived.
Confirmed outcomes and temporal evaluation are required.

See [the fair-value model card](../ml/fair-value-model-card.md) and
[fixture evaluation](../ml/evaluation-fixture-v1.md).
