# Architecture

## System shape

```text
Browser (React/Vite)
  -> TypeScript HTTP API
       -> provider registry/orchestrator
            -> mock fixtures (local/test only)
            -> eBay Browse official API adapter (credential/approval gated)
            -> Grailed adapter (written-authorization gated)
            -> Depop adapter (written-authorization gated)
            -> Yahoo! Auctions Japan adapter (written-authorization gated)
            -> Mercari Japan adapter (written-authorization gated)
       -> PostgreSQL request/data repositories
       -> guarded recommendation runtime

Worker process
  -> PostgreSQL job leases/checkpoints
  -> authorized real-provider adapters
  -> listing/state/price observations
  -> watchlist matcher + alert delivery state
  -> stale-listing maintenance + engagement rollups

Offline packages/ml
  -> immutable snapshots/artifacts/evaluation reports
  -> reviewed artifact supplied to API deployment
```

Provider-specific payloads remain inside `packages/providers`. Apps consume only
the normalized contracts in `packages/shared`.

## Runtime processes

### Web

`apps/web` is a React/Vite single-page product. It renders feed, search, brands,
likes, profile, alerts, and analytics; preserves URL search state; performs
IntersectionObserver pagination with an accessible button fallback; and sends
qualified, deduplicated interaction events.

The web build embeds `VITE_API_BASE_URL`. It never receives provider credentials
or accesses the database.

### API

`apps/api` is a TypeScript HTTP server. Major responsibilities are:

- provider selection, capability checks, orchestration, pagination, caching,
  deduplication, and degraded-state responses
- cookie sessions, account-security routes, saved-user features, entitlements,
  alert inbox, and durable engagement ingestion
- observed analytics and rules/ML recommendation selection
- OpenAPI contract, body/schema validation, consistent errors, request IDs,
  headers, rate limits, redacted structured logs, Prometheus metrics, a
  redacted durable operations-status view, health, readiness, and graceful
  shutdown

Production startup requires PostgreSQL and fail-closed real-provider
configuration. The production auth and saved-feature routes use the PostgreSQL
request store. SQLite remains a separate local/test compatibility path.

### Worker

`apps/api/src/worker/entrypoint.ts` is a separate process, not an API timer. It:

- migrates/opens PostgreSQL
- registers maintenance handlers
- creates ingestion sources only from active, non-mock real providers
- seeds recurring jobs idempotently
- claims jobs with database leases and heartbeat renewal
- checkpoints provider-native continuation state
- retries retryable failure with bounded exponential delay
- records last success/failure/provider health
- upserts normalized observations and matches changed listings to watchlists

Crash recovery comes from the durable job, lease, run, and checkpoint tables.
An expired lease can be claimed by another worker; idempotency keys prevent
duplicate ingestion effects.

### Offline ML

`packages/ml` is deterministic and offline-first. It owns feature schemas,
snapshot fingerprints, temporal splits, training, evaluation, immutable
artifacts, and promotion gates. It does not call providers or query production
inside request handling.

The API adapter loads a reviewed JSON artifact and has `disabled`, `shadow`, and
guarded `active` modes. It bounds candidates and deadline, verifies
model/feature versions and artifact lifecycle/staleness, applies provider/brand
diversity constraints, and returns the rules ranker on every validation,
timeout, or inference failure.

## Provider boundary

Every adapter declares capabilities and returns a normalized success or
classified failure. Raw response types are adapter-private. Normalization covers:

- stable provider/source listing identity
- validated destination and image URLs
- original exact price/currency plus optional shipping and landed total
- comparison/display conversion provenance when available
- title, canonical/provider brand, images, category, size, and condition
- listing type, active/sold/lifecycle/freshness state
- auction current bid, buy-now/completed price, bid count, and end time
- original-language and separately labeled translated text
- shipping payer, relist linkage, and discovery/proxy limitations
- seller fields only when supported
- attribution and mock/data-origin metadata
- analytics eligibility and exclusion reasons
- native page/cursor continuation

The orchestrator maintains per-provider continuation state in an opaque API
cursor, applies stable tie-breaks, deduplicates first by provider/source ID and
then by a conservative canonical fingerprint, and returns successful results
alongside explicit provider failures. Its process-local cache uses a 15-second
fresh TTL and a 60-second stale window. Stale data is labeled; it is never
rebranded as fresh.

The API creates one provider runtime per application process and reuses it for
feed, search, readiness, and provider health. Provider pacing, concurrency,
circuit, credential, and cache state therefore survives individual HTTP
requests. Each API replica and worker still owns an independent runtime, so
deployment-wide provider budgets must account for every process.

Credential-bearing eBay requests are restricted to reviewed official HTTPS
origins, and production accepts only the canonical production origin.
Authorized-live Grailed, Depop, Yahoo! Auctions Japan, and Mercari Japan are
restricted to provider-specific reviewed HTTPS origins. Grailed credential
bundle discovery is same-origin, and Algolia application IDs must match a
bounded alphanumeric grammar before they can enter a hostname. Provider HTTP
clients handle redirects manually, so authorization headers are never
implicitly forwarded to a redirect target.

Production cannot activate the mock provider or mock fallback. A recorded
fixture demonstrates contract behavior, not live authorization.

## Money and currency

`Money` keeps a backward-compatible major-unit display value and an exact
integer `amountMinor`. `ListingPricing` separates:

- `original`
- optional normalized `comparison`
- optional user `display`
- optional `shipping`
- optional `landed`

Conversions carry source/target currency, decimal rate, source, and timestamp.
If a valid recent quote is unavailable, the service returns no conversion and
the UI displays original currency. The current central exchange-rate service has
a deterministic/testable cache and staleness policy, but its default live rate
provider is disabled until an approved source is configured.

Price sorts partition by currency instead of pretending incomparable amounts
share a unit.

## Persistence

### Production PostgreSQL

`apps/api/src/db/postgres` provides:

- bounded pool, connection/query/statement timeouts, and pool/query metrics
- transactional repositories and transient transaction retry
- advisory-locked, checksummed forward migrations
- schema inspection/readiness and drift rejection
- normalized repository interfaces for API and worker data

PostgreSQL migrations:

| Version                                     | Scope                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_identity_and_access`                   | users, identities, account tokens, sessions, settings                                                                                                               |
| `002_catalog_ingestion_and_jobs`            | brands/aliases, listings/images/state/transitions, currency rates, monotonic price observations, ingestion checkpoints/health/events, worker jobs/runs              |
| `003_engagement_alerts_and_entitlements`    | likes/searches/filters/watchlists/preferences, raw and daily engagement, alert matches/deliveries, subscriptions/entitlements/webhook idempotency                   |
| `004_ml_and_operations`                     | datasets, feature snapshots, model versions, predictions, audit and maintenance records                                                                             |
| `005_request_store_hardening`               | token invalidation, email uniqueness, watchlist canonical/provider brand compatibility                                                                              |
| `006_user_engagement_features`              | per-user daily listing engagement features                                                                                                                          |
| `007_price_intelligence_and_alert_delivery` | typed asking/bid/completed/sold evidence, richer listing dimensions, alert event policy, verified phones, consent/suppression, unsubscribe, and webhook idempotency |

Important invariants include foreign keys, currency/state/amount checks, unique
provider listing identity, event idempotency, one verified email identity,
session/token hashes, and indexes aligned to feed, comparables, jobs, inbox, and
retention queries.

In PostgreSQL mode, feed/search persist the orchestrator's sanitized normalized
listings before returning them. Engagement and likes can therefore reference a
server-owned catalog row immediately; a browser listing snapshot is never an
authoritative catalog write. A catalog persistence failure returns an explicit
unavailable error rather than displaying inventory that cannot accept durable
events.

One collection observation has a stable idempotency identity. An exact replay
deduplicates, while a later unchanged collection refreshes `last_seen_at`
without creating a second price observation. This lets stale maintenance
distinguish a repeatedly seen unchanged listing from a listing no longer
returned by its provider.

Every new price change gets a database `observation_version`. Latest/history
queries order explicitly by that version, so writes in the same clock tick are
unambiguous.

### SQLite compatibility

The synchronous `node:sqlite` schema (`001` through
`007_account_security`) remains for local development, hermetic web/API tests,
and backward compatibility. It is not a supported production persistence or
high-availability architecture.

## Accounts and security

The browser holds an opaque `HttpOnly`, `SameSite=Lax` session cookie. Only a
peppered hash is stored. Production also requires `Secure`, explicit HTTPS
origins, and a secret pepper.

Account tokens are random, purpose-bound, pepper-hashed, expiring, superseding,
and one-time. Password reset updates the password and revokes every session
transactionally. Export excludes password/session/token hashes. Deletion checks
the exact username, removes directly user-owned records, and clears the user
association on retained pseudonymous engagement. Provider-wide observations
remain because they are not user-owned.

Cookie-authenticated mutations enforce Fetch Metadata/origin checks. Body size
is bounded and auth/account endpoints are rate limited. Current fixed-window
rate limiting is process-local; a distributed limiter is still required before
unbounded horizontal scale.

## Engagement and recommendation features

`POST /events` accepts an opaque privacy-session header and client event IDs.
The API derives any user ID from the session, rejects spoofing, and writes to
PostgreSQL with deduplication. The browser only reports an impression after a
card is at least 50% visible for one second.

Worker rollups populate listing and per-user daily features so feed requests do
not repeatedly scan raw events. The rules ranker consumes explicit preferences,
saved intent, likes, durable engagement aggregates, content quality, freshness,
and diversity. The ML adapter is layered around, not instead of, this fallback.

## Market analysis

Worker ingestion is the durable observation source; feed/search are no longer
the sole analytics source. Asking and confirmed sold observations are separate.
Comparables require matching normalized currency and minimum sample gates.
PostgreSQL analytics excludes currently stale/removed/unavailable inventory,
prioritizes confirmed sold observations independently within each
same-currency brand/category segment, and reports freshness, count, currency,
basis, and source coverage. Asking-only segments remain visible and explicitly
labeled rather than disappearing when another segment has sold data.

The offline fair-value model trains only on confirmed sold targets, prohibits an
active listing's asking price as a target/feature, uses temporal validation and
robust outlier handling, and carries interval/drift metadata. It is not promoted;
observed ranges remain active.

## Entitlements and alerts

Premium authorization is a persisted entitlement lookup. Username shortcuts no
longer exist. Billing tables and signed-webhook idempotency foundations exist,
but no billing provider route is active. A development grant path is
non-production-only and requires a verified admin identity.

Ingestion invokes idempotent watchlist matching for every persisted observation,
including an exact replay after a crash between the catalog write and worker
checkpoint. Matches are unique per watchlist/listing and carry reasons. The
alert repository stores
unseen/seen/dismissed state and delivery scheduling/attempt/retry/dead-letter
state with frequency and quiet-hour enforcement. In-app inbox routes are active.
No outbound channel is active.

## Operations

Deployment artifacts define separate migration, API, worker, web, PostgreSQL,
and backup processes. Readiness verifies database access, migration state, and a
real provider in production. `/operations/status` reports sanitized durable job,
checkpoint, and provider-health state without payloads, cursors, credentials, or
raw error messages. In production it, `/providers/health`, and `/metrics`
require a dedicated bearer token. `/metrics` exposes bounded-cardinality counters, gauges, and
latency histograms for HTTP/provider activity, PostgreSQL pool/query state,
provider rate limits/cache state, worker/ingestion health, engagement ingestion,
and recommendation request/fallback/version data. Secrets come from
environment/secret management.

Logical backup scripts create custom-format archives, checksums, optional
fail-closed `age` encryption, retention, and guarded isolated restore. Prefer a
managed service with encrypted storage and point-in-time recovery in production.

Application rollback uses prior immutable images while retaining
forward-compatible migrations. Database restore is an incident recovery action,
not a routine deploy rollback.

## Known architectural limits

- the four collection integrations are operator-authorized, but their deployable
  authorization-reference values and live credentials are absent; eBay
  credentials/approval are also absent
- the default exchange-rate provider is disabled
- billing is absent; outbound notification adapters exist but Resend/Twilio
  accounts, senders, secrets, callbacks, and staging evidence are absent
- process-local API rate limiting and process-local provider cache do not provide
  shared multi-replica state
- ML evidence is synthetic and insufficient for promotion
- authenticity/fake-risk is not a validated production subsystem
- this workstation has no Docker, so Compose evidence must come from CI or
  another equipped environment; local PostgreSQL and isolated logical-restore
  evidence does not prove managed HA, PITR, or encrypted off-host storage
