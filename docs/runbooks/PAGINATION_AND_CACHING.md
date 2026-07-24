# Pagination, Deduplication, and Caching

## API contract

Feed and search return normalized:

- `page`, `pageSize`, `hasMore`
- optional `nextPage`
- optional opaque `nextCursor`
- optional `totalCount` when it is safe to compute
- per-provider result/failure/freshness/cache summaries

The cursor contains versioned query identity, page size, stable page number,
per-provider page/cursor/exhaustion/total state, and bounded seen dedupe keys.
Clients must treat it as opaque.

## Deterministic merge

Each provider advances independently. The orchestrator can fetch bounded
additional provider pages when duplicates would otherwise underfill the page.
Listings receive deterministic tie-breaks from provider ID, provider listing ID,
and normalized listing ID.

Price sorts do not numerically mix currencies. Currency is the primary
partition; amount and stable identity break ties within a currency.

## Deduplication

The API uses:

1. stable `providerId + providerListingId`
2. a conservative canonical fingerprint only when title, canonical brand,
   category/size, exact price/currency, condition, and image identity are
   sufficiently complete

The web also prevents a card already rendered on a prior page from being added
again. The fingerprint is deliberately conservative: uncertain distinct
listings remain separate.

## Cache

Provider batch cache values are sanitized normalized successes only:

- fresh TTL: 15 seconds
- stale-while-revalidate window: 60 seconds
- failures are not cached as successful data
- stale responses carry stale/cache metadata
- cache is process-local and disappears on restart

The cache is a provider-protection/performance layer, not durable catalog
storage. In PostgreSQL mode the API persists sanitized normalized results before
returning feed/search, so immediately displayed cards can accept durable events
and likes. Scheduled worker ingestion remains the independent, resumable source
for systematic listing lifecycle, price history, stale maintenance, and
watchlist coverage.

## Web behavior

- search/filter/sort state persists in the URL
- changing a query/filter/sort resets continuation
- an IntersectionObserver sentinel requests the next page
- an accessible Load More control remains available
- page merges prevent duplicate cards
- scroll position is restored on return navigation
- a next-page failure keeps existing results and shows a retry state
- empty, partial, provider-limited, stale, and session-expired states are
  distinct

## Failure behavior

One provider failure does not erase successful results. The response includes the
failed provider, reason, retryability, and degraded state. If every real provider
fails in production, the request fails/degrades explicitly; mock inventory is
never substituted.

Unsupported filters are capability failures, not silently ignored inputs.

## Operational limits

- cursor size can grow with bounded seen keys across a long session
- process-local cache is not shared between API replicas
- each API process owns one long-lived provider runtime; provider concurrency,
  pacing, circuit, credential, and cache state is not shared across replicas
- feed ranking is applied to the currently assembled candidate page rather than
  every listing in the durable catalog
- provider native behavior can change; fixture tests and health metrics must be
  reviewed after adapter updates

Tests cover per-provider continuation, stable tie-breaks, cross-page/provider
dedupe, stale cursor/query rejection, cache fresh/stale behavior, partial
failure, timeout/rate-limit/circuit behavior, and frontend merge/loading states.
