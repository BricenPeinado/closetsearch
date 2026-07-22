# Personalization Runbook

This runbook covers the rules-based feed ranking added in Milestone 17.

## Scope

Personalization V2 improves the signed-in home feed without adding ML, alerts, or analytics V1.

It does include:

- persisted likes as real ranking input
- onboarding preferences
- saved searches
- saved filters
- watchlist shell intent as a weak signal
- preferred sources from user settings
- freshness, listing quality, engagement, diversity, and repetition rules
- optional debug score breakdowns

It does not include:

- embeddings or vector search
- model training or ML ranking
- alert delivery
- notification jobs
- analytics V1
- underpriced listing detection
- fake-risk intelligence

## Inputs

Current ranking inputs are additive and inspectable.

User-signal inputs:

- liked listing brands, categories, sizes, conditions, sources, and listing types
- onboarding favorite brands and categories
- onboarding price range
- saved search query terms, brands, categories, sizes, sources, listing types, and price ranges
- saved filter query text, source, listing type, and price ranges
- watchlist query text, brand, source, and max price as weak intent only
- preferred sources from user settings

Listing-state inputs:

- freshness relative to the newest feed candidates
- listing completeness across title, brand, image, source URL, price, category, size, and condition
- lightweight impression-count engagement from the in-process engagement store

## Scoring Weights

Current weights are intentionally simple and reviewable. They are implemented in `apps/api/src/services/personalizationSignalsService.ts` and `apps/api/src/services/recommendationService.ts`.

Representative signal weights:

- liked brand affinity: `3.4`
- onboarding brand affinity: `2.6`
- liked category affinity: `2.3`
- onboarding category affinity: `1.9`
- preferred source affinity: up to `1.45` from settings, with weaker saved-search/filter/watchlist source boosts
- saved-search query intent: about `1.05` per matching term, capped in the scorer
- saved-filter price preference: about `0.9` when in-range, with smaller near-range boosts
- freshness: `1.6` for very new listings down to strong negative penalties for very stale ones
- listing quality: small positive boost for complete listings and small penalties for incomplete ones
- engagement: small capped boost from impression counts

These numbers are not hidden hard filters. They are soft boosts and penalties that still allow exploration candidates to appear.

## Diversity And Exploration

Personalization should not collapse the top of the feed into one brand or one source.

Current controls:

- repeated brands near the top receive a penalty
- repeated categories near the top receive a smaller penalty
- repeated sources near the top receive a smaller penalty
- near-identical listing signatures receive an extra penalty
- personalized ranking is mixed with a small exploration lane using a `3 personalized / 1 exploration` cadence

This keeps relevant matches strong without turning the feed into a narrow clone list.

## Repetition Rules

Current repetition controls include:

- duplicate listing IDs are removed before ranking
- near-identical signatures are penalized during selection
- repeated brands, categories, and sources are penalized as the first page is built

These controls are intentionally lightweight and local to feed ranking. They are not session-history or long-term fatigue systems yet.

## Cold Start Behavior

Cold-start users should still get a usable feed.

Behavior:

- signed-out users get the generic newest-first feed
- signed-in users with onboarding preferences but no likes can still get brand/category/price boosts
- signed-in users with no meaningful signals fall back to the generic feed and see a gentle prompt to like listings or save searches

## Debugging

Use `GET /feed?debugPersonalization=1` to inspect ranking reasons during development and tests.

Debug output includes:

- `personalizationSummary`
- `debugPersonalization.scoreBreakdowns[]`
- per-listing reason codes such as `brand_affinity`, `category_affinity`, `source_preference`, `price_affinity`, `query_intent`, `freshness`, `listing_quality`, and repetition penalties

Debug output should remain development-oriented and should not expose full sensitive user account state.

## Known Limitations

Still deferred to future milestones:

- ML ranking or embeddings
- richer long-term engagement features
- alert delivery from watchlists
- analytics V1 and observed pricing pipelines
- stronger provider diversity once live providers broaden beyond the current baseline
