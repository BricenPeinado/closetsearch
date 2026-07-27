# Provider Operations and Compliance

## Source of truth

Read the [provider acquisition matrix](../provider-acquisition-matrix.md) before
enabling or changing an adapter. An implementation, credential, fixture, public
page, or technically reachable endpoint is not authorization.

Acquisition order:

1. official public API
2. approved partner/affiliate API
3. documented feed
4. explicitly authorized server-side scraping

Never bypass authentication, CAPTCHA, robots restrictions, technical blocks, or
rate enforcement. Do not rotate identities or proxies to evade controls.

## Implemented providers

| Provider              | Adapter                                       | Capability                                                            | Live state in this checkout                                     |
| --------------------- | --------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| mock                  | deterministic fixtures                        | active/sold fixture flows                                             | local/test only; prohibited in production                       |
| eBay                  | official Browse API + OAuth application token | active inventory, auction metadata, offset pagination                 | blocked: credentials, approval reference, and live smoke absent |
| Grailed               | HTML configuration plus Algolia adapter       | active/sold fixed-price pages                                         | blocked: durable authorization reference absent                 |
| Depop                 | reviewed web API adapter                      | active/sold fixed-price listings, cursor pagination                   | blocked: durable authorization reference absent                 |
| Yahoo! Auctions Japan | reviewed marketplace adapter                  | active auctions/fixed price, confirmed sold outcomes, page pagination | blocked: durable authorization reference absent                 |
| Mercari Japan         | reviewed marketplace adapter                  | active/sold fixed-price listings, cursor pagination                   | blocked: durable authorization reference absent                 |

There are zero authorized live providers in the repository state. The target of
five working real providers is externally blocked by deployment inputs, not by
the adapter implementation.

## Provider contract

Adapters:

- accept normalized search input
- expose exact capabilities instead of silently ignoring unsupported filters
- keep raw response types private
- normalize stable provider/source IDs, listing data, exact original money,
  lifecycle/status, seller/shipping when supported, attribution, and analytics
  eligibility
- validate destination and image URLs
- return provider-native pagination state
- distinguish retryable and terminal failures
- emit freshness, fetch time, latency, data origin, result count, and warnings

The shared resilient HTTP layer enforces bounded timeout, pacing, concurrency,
retry, `Retry-After`, and circuit state. Provider-specific values remain
configurable within bounded ranges.

The API constructs one provider runtime at application creation and reuses it
for feed, search, readiness, and provider-health calls. This makes pacing,
concurrency, circuit, credential, and cache state meaningful across requests.
Every API replica and worker owns a separate runtime, so calculate provider
budgets across the whole deployment.

## eBay activation

The adapter uses the official client-credential token endpoint and Browse search.
It intentionally reports sold-history and normalized taxonomy filters as
unsupported when they cannot be mapped safely. Use returned affiliate URLs and
required attribution when the approved program requires them.

Before activation:

1. obtain production Buy API eligibility and agreements
2. create production client credentials in secret management
3. document permitted display, caching, retention, price history, analytics/ML,
   attribution, regions, and deletion obligations
4. configure the marketplace and approved affiliate campaign
5. run fixture/contract tests
6. run a credentialed staging smoke separately from normal CI
7. confirm `/providers/health` reports `official-api`

Do not scrape eBay when its supported API is the approved path.

## Grailed activation

The code can extract public-page configuration and query normalized active/sold
indices. The operator has established authorization for this integration, but
this checkout does not contain the required deployable
`GRAILED_AUTHORIZATION_REFERENCE` value.

Before activation, retain a non-secret reference to written permission covering:

- approving party, effective/expiry date, and revocation contact
- hosts/endpoints, access method, deployment identities, and regions
- approved active/sold fields and seller/shipping data
- display, attribution, caching, retention, deletion, price history, analytics,
  and ML
- rate/concurrency/request-profile limits

Only then set both:

```sh
GRAILED_SCRAPING_ALLOWED=true
GRAILED_AUTHORIZATION_REFERENCE=<retained-reference>
```

Pacing in code is not a grant. Robots/terms/permission changes require immediate
disablement and compliance review. Do not add proxy rotation or browser
automation to work around a block.

## Depop and Japan activation

Depop, Yahoo! Auctions Japan, and Mercari Japan follow the same three-part
activation gate:

```sh
<PREFIX>_PROVIDER_ENABLED=true
<PREFIX>_SCRAPING_ALLOWED=true
<PREFIX>_AUTHORIZATION_REFERENCE=<retained-reference>
```

Use prefixes `DEPOP`, `YAHOO_AUCTIONS_JP`, and `MERCARI_JP`. Before activation,
verify the retained reference covers exact origins/endpoints, deployment
identities/regions, request rate, fields, active/sold semantics, attribution,
translation, retention/deletion, analytics/ML, and incident contacts. Validate
domestic-only/proxy notices for the Japanese sources. A technical response,
operator flag, or fixture is not a substitute for that record.

See the provider-specific notes under
[`docs/marketplace-notes`](../marketplace-notes/).

## Partial failure behavior

The orchestrator returns valid listings alongside explicit provider summaries.
It does not erase one provider's successful data because another times out,
rate-limits, opens a circuit, or rejects a capability.

Frontend banners use:

- provider success/failure
- retryability
- cache status and freshness
- warnings and result counts
- the distinction between limited capability and runtime degradation

When all real providers fail in production, return an unavailable/degraded state.
Never substitute fixtures.

## Worker ingestion

The worker registry filters out mock/fixture sources and creates jobs only for
active real providers and supported active/sold scopes. It stores per-provider
query checkpoints, continuation cursors, last success/failure, next run, and
health.

On startup inspect the structured `worker_jobs_seeded` event:

- `activeProviderIds` must contain exactly the intended authorized providers
- `blockedProviders` must be empty or match an understood external blocker

Provider ingestion is idempotent, resumes after lease expiry/crash, persists
listing lifecycle/price changes, and invokes watchlist matching for new/changed
observations.

An exact replay of one collection observation deduplicates. A later collection
of an unchanged listing refreshes `last_seen_at` but does not create a false
price change, so stale maintenance does not hide inventory that providers still
return.

## Testing policy

Normal test suites:

- use recorded/redacted fixtures or local stub responses
- cover complete, partial, malformed, hostile URL, pagination, retry, timeout,
  429, circuit, and normalization behavior
- must not call a marketplace or require live credentials

Credentialed staging smoke is a separate, explicitly authorized operation and
requires `LIVE_PROVIDER_SMOKE_TESTS=true`.
Never record secret headers or raw tokens in fixtures, logs, metrics, CI
artifacts, or issue reports.

## Incident response

For a provider outage or permission concern:

1. disable only the affected provider
2. retain health/request IDs and redacted metrics
3. honor `Retry-After` and circuit state
4. show a partial/unavailable product state
5. contact the provider/approval owner
6. do not rotate identities, increase concurrency, or enable mock fallback

See [Incident response](INCIDENT_RESPONSE.md).
