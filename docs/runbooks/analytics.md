# Analytics Runbook

## Scope

ClosetSearch Analytics V1 provides observed pricing context only. It does not forecast future prices, recommend purchases, score authenticity, or send alerts.

## Price Snapshot Recording

Observed price snapshots are recorded from normal product flows:

- `GET /feed`
- `GET /search`

Recording rules:

- use normalized listings only after provider orchestration completes
- keep recording best-effort so feed/search still succeed if analytics recording fails
- skip listings with unusable prices or listings explicitly excluded from analytics
- dedupe repeated same-price observations by updating `last_seen_at`
- create a new snapshot row when the same source listing is seen at a changed observed price

## Market Range Calculations

Observed ranges are built from the latest snapshot for each source listing.

Current summaries:

- brand pricing ranges
- category pricing ranges
- count
- min
- max
- median
- average
- quartiles when sample size is large enough

Ranges use normalized same-currency observed prices only.

## Similar Listing Comparisons

Listing comparisons use observed listings with matching brand and category, then narrow further when enough data exists:

- brand + category + condition when sample size is sufficient
- brand + category + listing type when sample size is sufficient
- otherwise brand + category

Minimum sample-size behavior:

- require at least 4 comparable observed listings before returning a real comparison signal
- if too few comparable listings exist, return a limited-data state
- if similar listings exist but currencies do not match, return a currency-limited state instead of forcing a comparison

## Under-Market Wording Rules

Allowed language:

- Observed range
- Below observed range
- Below observed median
- Near observed range
- Not enough observed data
- Lower than similar observed listings

Disallowed language:

- Guaranteed underpriced
- Profit
- Investment
- Prediction
- Buy now
- Authentic / fake verdicts

## Disclaimers

Analytics UI and API responses should preserve these boundaries:

- Based on listings ClosetSearch has observed.
- Not financial advice.
- Not a prediction.
- Availability and prices may change.

## Known Limitations

- snapshot history only reflects listings ClosetSearch has seen through normal feed/search traffic
- mock-only environments produce mock-only analytics summaries
- there is no forecasting, trend modeling, or resale intelligence layer yet
- there is no alert delivery or watchlist notification integration yet
- there is no fake-risk or authenticity logic inside analytics
