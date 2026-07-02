# Providers

## Overview

ClosetSearch keeps provider-specific request logic inside `packages/providers` and exposes only normalized listing/search results to the API and web apps.

Grailed now has two authorized-live stages:

- fetch Grailed's public HTML shell and extract dynamic Algolia credentials from `window.PUBLIC_CONFIG`
- query Grailed's Algolia indexes directly for active marketplace listings or sold-history comps

The mock provider remains available for local development, tests, and fallback paths.

## Grailed Dynamic Credential Extraction

Runtime files:

- `packages/providers/src/grailed/credentials.ts`
- `packages/providers/src/grailed/algolia.ts`
- `packages/providers/src/grailed/provider.ts`
- `packages/providers/src/grailed/http-client.ts`

Credential extraction flow:

1. Request `https://www.grailed.com` with browser-mimicking headers.
2. Locate the inline `window.PUBLIC_CONFIG = {...};` assignment.
3. Extract the balanced JSON object.
4. Parse and validate `algolia.appId` and `algolia.apiKey`.
5. Cache the credentials in memory for reuse.

If `window.PUBLIC_CONFIG`, `algolia.appId`, or `algolia.apiKey` are missing, the provider throws a clear runtime error instead of silently degrading into malformed downstream requests.

## Credential Cache And Rotation

The Grailed provider keeps an in-memory credential cache inside the provider instance.

Current behavior:

- cache TTL: `15 minutes`
- cache storage: in-memory only
- cache scope: per API process / provider instance
- cache refresh trigger: cache miss, cache expiry, or Algolia `401` / `403`

Rotation behavior:

- live queries use cached credentials by default
- if an Algolia query returns `401` or `403`, the cache is evicted
- the provider re-harvests credentials from Grailed HTML
- the Algolia query is retried exactly once
- a second `401` / `403` fails as a provider credential error

No plaintext developer secrets are stored in source control.

## Grailed Algolia Query Engine

Index mapping:

- active listings: `Listing_production`
- sold comps: `Listing_sold_production`

Query behavior:

- requests are sent to `https://{appId}-dsn.algolia.net/1/indexes/{indexName}/query`
- requests use `hitsPerPage=100`
- the provider preserves the normalized request page while translating to Algolia's zero-based page param
- `marketScope=active` targets live offers
- `marketScope=sold` targets realized sale history

The API/provider contract keeps `marketScope` normalized. Raw Algolia index names do not leak to the frontend.

## Headers, Pacing, And Safeguards

Grailed requests use conservative server-side headers and pacing:

- explicit `ClosetSearchBot/... contact:<email>` user agent
- `accept-language`, `cache-control`, and keep-alive style headers
- HTML and JSON requests both run through the same timeout and pacing logic
- provider request pacing still defaults to `3000ms`
- provider request timeout still defaults to `5000ms`

If Grailed or Algolia responds with `429`, the provider returns a recoverable rate-limit failure.

## Normalized Grailed Listing Mapping

Grailed Algolia hits are mapped into shared product-facing listing types.

Normalized fields include:

- listing id and provider listing id
- source URL
- title and brand
- image URL
- price and currency
- category, size, condition, and listing type when available
- seller metadata:
  - username
  - feedback score
  - feedback count
  - trust tier
- market metadata:
  - `active` vs `sold`
  - tags
  - `priceDropsCount`
  - `isExcludedFromAnalytics`

Low-confidence sellers are tagged with `trustTier="unverified"`, and those listings are marked `isExcludedFromAnalytics=true` to protect future market-analysis curves.

## Proxy Notes

This milestone does not add a dedicated proxy layer.

If Grailed's public shell or Algolia edge starts blocking requests from the deployment environment, a later pass may need:

- a server-side outbound proxy
- region-aware routing
- stronger retry/backoff memory
- alternate credential-harvest sources if the public shell changes

No heavyweight browser automation is used in this pass.

## Known Limitations

- credential caching is process-local only and resets on restart
- dynamic extraction depends on Grailed continuing to expose `window.PUBLIC_CONFIG`
- no persistent analytics storage or sold-comp snapshots are created yet
- active and sold data are normalized into shared listing models, but the web UI does not yet expose a dedicated sold-comp browsing surface
- the provider still relies on documented written authorization for live scraping access
