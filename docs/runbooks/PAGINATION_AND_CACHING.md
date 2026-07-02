# Pagination And Caching

## Overview

Milestone 13 connects feed and search to normalized provider-backed pagination without exposing provider-specific response shapes to the web app.

Current behavior:

- feed and search both return a shared frontend-facing pagination object
- the API can continue pagination with either a normalized `nextPage` or an opaque `nextCursor`
- the current web UX uses load-more, not infinite scroll
- duplicate listings are removed conservatively across repeated batches, pages, and provider combinations
- the mock provider still remains available for tests, local development, and fallback paths
- short-lived in-memory caching reduces repeated provider requests for identical search batches

## Normalized Pagination Shape

Feed and search responses now return:

- `pagination.page`
- `pagination.pageSize`
- `pagination.hasMore`
- `pagination.nextPage` optional
- `pagination.nextCursor` optional
- `pagination.totalCount` optional when the provider layer can determine it safely

Shared type location:

- `packages/shared/src/domain/pagination.ts`

The frontend only sees this normalized shape. Raw provider pagination fields stay inside the provider and API orchestration layers.

## Provider Boundary

Provider pagination is represented separately inside the provider package:

- `ProviderSearchRequest.pagination` carries provider-facing page or cursor input
- `ProviderSearchResult.pagination` carries provider-facing page or cursor output

Current provider behavior:

- mock provider supports page-style pagination and returns normalized metadata
- Grailed currently behaves as a page-based provider path
- provider-native cursors are supported by the orchestrator contract, but the current real provider path does not use them yet

## Feed Behavior

Feed requests start from:

- `GET /feed?page=1&pageSize=12` for the initial page

Load-more behavior:

- the web app prefers `nextCursor` when present
- otherwise it falls back to `nextPage`
- if a provider omits pagination metadata, the API falls back to `hasMore: false` instead of crashing
- if all active providers fail and no listings are available, the API returns a recoverable `feed_unavailable` error
- feed personalization still runs after the provider page is fetched, so ranking is page-local rather than globally re-ranked across the entire provider corpus

## Search Behavior

Search requests start from:

- `GET /search?...&pageSize=24` for the first page

Load-more behavior:

- the original normalized query, filters, and sort stay stable across pagination
- the web app sends the same search params and adds `cursor` or `page` for the next batch
- changing query, filter, or sort resets pagination by creating a fresh first-page request
- empty state only renders when the first page has no listings
- later-page failures surface a retryable load-more error state instead of wiping the existing results
- recent searches are only saved after a successful first-page response

## Dedupe Strategy

Dedupe is conservative and happens in both the API and web layers.

API dedupe order:

- `providerId + providerListingId`
- `source.id + sourceUrl` fallback
- normalized `title + brand.slug + price.amount + price.currency + imageUrl` fallback hashed into a short internal key

Web dedupe order when merging pages:

- `providerId + providerListingId`
- `source.id + sourceUrl` fallback
- `listing.id` final fallback

This removes duplicate cards across:

- repeated provider batches
- repeated load-more requests
- overlapping provider pages
- mock plus real fallback combinations

The dedupe is intentionally conservative and does not attempt fuzzy duplicate matching across distinct listings.

## Cache Strategy

The provider orchestrator has a short-lived in-memory batch cache.

Current settings:

- TTL constant: `PROVIDER_SEARCH_CACHE_TTL_MS = 15_000`
- location: `apps/api/src/providers/orchestrator.ts`

Cache key inputs include:

- normalized provider query
- requested page size
- provider id and mode
- provider page or cursor input

Cache behavior:

- only successful provider batches are cached
- failures are not cached aggressively
- expired entries are removed opportunistically during reads
- the cache is process-local and disappears on restart
- cached batches are sanitized before storage so provider-only raw fields do not leak upward

## Provider-Specific Caveats

Mock provider:

- deterministic page-based pagination used by tests and local fallback paths

Grailed:

- current path is page-based rather than cursor-based
- pagination metadata is normalized at the provider boundary before reaching the API response
- live behavior still depends on the marketplace returning stable page results under the approved request profile

## Known Limitations

- the current web UX is load-more only; infinite scroll was not added in this pass
- `totalCount` is only returned when the provider layer can determine it safely across active providers
- the opaque API cursor stores provider progress and seen dedupe keys, so cursor size can grow across longer pagination sessions
- feed personalization is applied after each fetched page, not as a full cross-page rerank
- the in-memory cache is per-process and not shared across server instances
- current real-provider pagination is page-oriented; provider-native cursor behavior remains future-facing contract support

## Tests Added

Coverage for this pass lives primarily in:

- `apps/api/src/pagination.test.ts`
- `apps/api/src/providers/orchestrator.test.ts`
- updated provider tests in `packages/providers/src/examples/mock-provider.test.ts` and `packages/providers/src/grailed/provider.test.ts`
- updated API contract tests in `apps/api/src/app.test.ts`

These tests cover normalized pagination, next-page flow, dedupe, cache reuse, stale-cursor reset behavior, recoverable failures, and mock fallback.

## Future Milestones

This pass does not add:

- database-backed cursor or cache persistence
- globally merged ranking across deep multi-provider pagination
- infinite scroll
- new marketplace providers

Milestone 14 should focus on persistence primitives that can later support longer-lived caches, saved searches, and more durable pagination/session state.
