# Tasks

This roadmap reports the repository as it exists now. A checked item means the
implementation and its scoped automated evidence are present; it does not turn
an external credential, legal approval, production dataset, or provider account
into something ClosetSearch possesses.

Status categories are intentionally separate:

- **Foundation complete:** durable product/contracts established.
- **Production implementation complete:** internal code and executable tests are
  present at the stated scope.
- **Externally blocked:** safe internal work is complete or can continue, but
  activation requires approval, credentials, configuration, or data not in the
  repository.
- **Intentionally deferred:** the product must not claim or enable the feature
  yet.

## Foundation complete

- [x] pnpm TypeScript monorepo with React/Vite web, HTTP API, shared, providers,
      and ML packages
- [x] normalized listing/search/brand/user/analytics/recommendation contracts
- [x] provider-adapter boundary that keeps raw payloads private
- [x] deterministic mock fixtures for local development and normal CI
- [x] feed, search, brand directory, auth/onboarding/profile, likes, saved
      searches, saved filters, watchlists, and analytics product surfaces
- [x] canonical brand/alias dataset shared by normalization and product browsing
- [x] cautious analytics and authenticity language boundaries
- [x] immutable pre-implementation
      [production gap matrix](docs/production-gap-matrix.md)
- [x] source-by-source
      [provider acquisition matrix](docs/provider-acquisition-matrix.md)

## Production implementation complete

### Provider and discovery internals

- [x] official eBay Browse adapter with OAuth client-credential flow, native
      offset pagination, active-listing capability reporting, exact money,
      attribution fields, URL validation, fixtures, malformed-payload tests, and no
      claim of sold-history support
- [x] Grailed adapter fixtures/normalization and an authorization gate requiring
      both `GRAILED_SCRAPING_ALLOWED=true` and a retained
      `GRAILED_AUTHORIZATION_REFERENCE`
- [x] classified terminal/retryable failures, timeouts, `Retry-After`, bounded
      exponential retry, pacing, concurrency limits, and circuit behavior
- [x] deterministic per-provider continuation state and merge tie-breaks
- [x] source-ID plus conservative canonical-fingerprint deduplication
- [x] provider freshness/latency/degraded summaries and partial-result behavior
- [x] 15-second fresh cache plus 60-second stale-while-revalidate window
- [x] one provider runtime per API process so pacing, concurrency, circuit,
      credential, health, and cache state persists across requests
- [x] credential-bearing eBay/Grailed requests are restricted to reviewed HTTPS
      origins, redirects are manual, Grailed bundles are same-origin, and
      Algolia application IDs cannot inject a host/path
- [x] malformed live/provider rows are dropped with degraded metadata while
      valid rows on the page continue
- [x] production startup rejects mock mode, active mock provider, and mock
      fallback
- [x] normal tests use recorded fixtures and do not call live marketplaces

### Normalized data and web UX

- [x] original/comparison/display/shipping/landed money contracts with integer
      minor units and exchange-rate provenance
- [x] deterministic conversion/cache/staleness tests and original-currency
      fallback when a quote is unavailable
- [x] no cross-currency numerical comparison without conversion; price sorting
      remains currency-partitioned
- [x] normalized lifecycle/freshness, active/sold/stale status, seller,
      attribution, images, shipping, and analytics eligibility
- [x] cards with aspect reservation, lazy images, local failure fallback,
      marketplace CTA, accessible like state, optional metadata, and honest
      analytics states
- [x] URL-persisted filters, duplicate prevention, IntersectionObserver paging,
      accessible Load More fallback, scroll restoration, retry/partial/stale/session
      states, keyboard focus, and responsive layouts
- [x] placeholder authenticity risk hidden/kept out of production claims

### PostgreSQL and worker

- [x] PostgreSQL is required by production startup; SQLite is explicitly
      local/test compatibility only
- [x] pooled PostgreSQL access, bounded connection/query/statement timeouts,
      transient transaction retry, and database metrics
- [x] forward migrations `001` through `006` with checksums, advisory locking,
      pending-state readiness, rename/checksum/out-of-order drift detection
- [x] production schema for identities/sessions/settings, catalog/history,
      currency, ingestion/jobs, engagement, saved features/watchlists, alerts,
      entitlements/billing idempotency, ML metadata, and operations/audit
- [x] production request paths for auth, onboarding, likes, searches, filters,
      watchlists, settings, account security, alerts, and engagement use PostgreSQL
- [x] unique/check/foreign-key constraints and indexes for current query paths
- [x] idempotent concurrent listing upserts and transactional rollback tests
- [x] exact ingestion replay dedupe plus later unchanged-observation freshness
      updates without duplicate price history
- [x] deterministic price history uses database monotonic
      `observation_version`, including repeated same-timestamp transitions
- [x] separate worker entry point with durable leases/heartbeat, retries,
      schedules, run state, continuation checkpoints, and graceful stop
- [x] worker filters mock sources, ingests authorized real providers only,
      persists listing lifecycle/price changes, marks stale listings, rolls
      engagement, and matches watchlists
- [x] logical backup/restore scripts with custom archive verification, checksum,
      optional fail-closed `age` encryption, retention, and guarded isolated target

### Engagement, entitlements, accounts, and alerts

- [x] qualified viewport impressions require 50% visibility for one second
- [x] PostgreSQL feed/search make sanitized provider listings durable before
      response; engagement and likes reference the server-owned catalog
- [x] durable, event-ID-deduped viewport/click/like/unlike/search/filter/save/
      watchlist/recommendation events with opaque privacy-session identifiers
- [x] daily catalog and per-user feature aggregates
- [x] username-based premium access removed
- [x] persisted provider-neutral entitlements with expiry/revocation semantics
- [x] non-production development grant requires a verified admin identity and
      cannot masquerade as billing
- [x] worker-driven idempotent watchlist matching and in-app alert inbox
- [x] an ingestion crash after catalog/alert persistence safely replays matching
      on the duplicate observation without duplicating a match or delivery
- [x] unseen/seen/dismissed alert lifecycle plus outbound-repository
      frequency/quiet-hour scheduling, durable attempts, and
      retry-wait/suppression/dead-letter states
- [x] scrypt password hashing, central 12–128 character password policy,
      session-token hashing, origin/CSRF controls, body limits, secure production
      cookies, and auth/account endpoint rate limits
- [x] verified-email, password-reset, account-export, and account-deletion API
      flows use short-lived, purpose-bound, hashed, superseding, one-time tokens
- [x] web account-security controls and one-time action pages for email
      verification, password reset, export download, and confirmed deletion
- [x] password reset revokes all sessions; exports omit credential/token hashes;
      deletion removes directly user-owned state while pseudonymous engagement
      loses its user association under the documented draft retention boundary

### ML and market analysis

- [x] reproducible offline ML package with versioned feature schemas,
      deterministic seeds/fingerprints, temporal splits, leakage tests, immutable
      artifacts, and model/dataset cards
- [x] hybrid implicit/content recommendation candidate with cold-start,
      popularity/freshness, provider/brand diversity, and offline ranking metrics
- [x] guarded API recommendation runtime with disabled/shadow/active modes,
      artifact/version/lifecycle/staleness checks, 500-candidate bound, 1–250 ms
      timeout, non-sensitive reasons, and rules fallback
- [x] recommendation request metadata and metrics include selected strategy,
      fallback reason, artifact/model/feature version, overlap, and latency
- [x] confirmed-sold fair-value dataset boundary; asking price is prohibited as
      a realized target/feature
- [x] robust comparable selection, outlier handling, temporal/segment
      evaluation, interval/drift/staleness gates, safe wording, and observed-range
      fallback
- [x] PostgreSQL observed analytics excludes currently stale inventory,
      separates asking/sold, selects sold-first per same-currency segment, and
      reports sample/currency/basis/freshness/source context

### API, tests, and operations

- [x] domain route modules for operations, brands, engagement, entitlements,
      PostgreSQL auth/account/saved features, and analytics while preserving public
      behavior
- [x] request IDs, consistent errors, security headers, redaction, body limits,
      rate limits, liveness/readiness/metrics, startup validation, and graceful
      shutdown
- [x] redacted PostgreSQL-backed operations status plus bounded-cardinality
      request/provider latency, rate-limit/cache, worker-job, ingestion-lag, and
      provider-health metrics
- [x] published OpenAPI JSON with automated route/schema/security contract tests
- [x] provider, pagination/dedupe/cache/resilience, currency, deterministic
      price, PostgreSQL repository, worker lease/resume, ML leakage/training/
      evaluation, auth/security, component, and Playwright tests
- [x] axe-core WCAG A/AA browser scans for signed-out Home/Login and signed-in
      Profile/Alerts, including a measured shared muted-text contrast correction
- [x] separately gated real-PostgreSQL tests for clean/prior-schema migration,
      concurrent idempotent upserts, transaction rollback, lease contention, and
      durable session revocation
- [x] API/web/worker Dockerfiles, Compose PostgreSQL/migration/API/worker/web
      topology, reverse proxy, CI jobs, infrastructure validation, and production
      no-mock smoke script
- [x] deployment, incident, backup/restore, and roll-forward/rollback runbooks

## Externally blocked

- [ ] **eBay live activation:** obtain production Buy API client credentials,
      partner eligibility/agreements, approved use/retention scope, and any required
      affiliate campaign attribution; then run a non-mock staging smoke.
- [ ] **Grailed live activation:** retain exact written permission covering the
      access method, hosts, identities, rate/concurrency, fields, retention,
      attribution, price history, analytics/ML, and revocation; set the repository
      reference and run a separately authorized staging smoke.
- [ ] **Two independently live real providers:** neither adapter is authorized in
      this checkout; fixtures do not satisfy this target.
- [ ] **Transactional account email:** select/configure an approved provider and
      sender domain, then test verified-address delivery, suppression, retries, and
      privacy behavior.
- [ ] **Production billing:** select/configure a subscription provider, verify
      signed webhooks and idempotency end to end, and document refund/cancellation
      behavior.
- [ ] **Live exchange rates:** select/configure an approved source and persistence
      schedule; until then the default runtime intentionally displays original
      currency.
- [ ] **ML promotion data:** collect privacy-reviewed temporal production
      snapshots with enough users/outcomes and confirmed sold comparables.
- [ ] **Public no-mock staging evidence:** requires an authorized provider,
      deployed HTTPS environment, secret manager, and current provider approval.

## Intentionally deferred

- [ ] push notifications and SMS
- [ ] outbound email alerts until verified email plus a delivery provider are
      configured
- [ ] active recommendation ML until every sample/relevance/diversity/
      concentration/latency gate passes and promotion is approved
- [ ] fair-value model output until accuracy and interval-coverage gates pass
- [ ] authenticity/fake verdicts or production fake-risk scoring until a labeled
      dataset, abuse review, calibration, and evaluation plan exist
- [ ] OAuth/social login, seller tools, marketplace posting, and social messaging
- [ ] shared distributed API rate limiting and shared provider cache before
      unrestricted horizontal scaling
- [ ] further split the remaining legacy API dispatcher
      (`apps/api/src/app.ts`) and web route/state composition
      (`apps/web/src/app.tsx`); domain repositories/routes and the most
      independent web components are extracted, but both entry modules remain
      oversized
- [ ] add an approved external error-tracking sink and deployment dashboards;
      current redacted structured logs and Prometheus metrics have no
      vendor-neutral exception-export hook

## Remaining release evidence

These are open even where the implementation exists:

- [ ] obtain a current clean pass for every required root command
- [x] record five consecutive clean full test runs on final code commit
      `3072b33` with the real-PostgreSQL gate enabled
- [ ] retain a successful CI run of the gated real-PostgreSQL migration,
      concurrent-write, lease-contention, rollback, and session-revocation suite
- [x] retain local PostgreSQL stop/start persistence evidence and repeat the
      ten-flow PostgreSQL browser suite after restart
- [ ] create an encrypted production-style backup and complete a timed isolated
      restore drill with retained row-count/schema evidence
- [ ] build and boot the current Compose topology and validate every healthcheck
- [ ] run critical signed-out, signed-in, degraded-provider, database-restart,
      analytics, watchlist/inbox, account recovery, and session-expiry flows end to
      end
- [ ] run a provider-authorized staging smoke proving no fixture inventory
- [ ] review dependency/image scans and operational dashboards

This workstation has no Docker executable. An ephemeral local PostgreSQL 17.10
run verified migrations, real-engine repository behavior, PostgreSQL-backed
Playwright, five consecutive full suites, an actual database-process restart,
and a checksummed isolated logical restore. All locally executable required
commands pass except the production smoke, which correctly fails closed because
no authorized HTTPS deployment URL exists. This is valid local engine evidence;
it is not a Compose boot, managed-HA/PITR, encrypted off-host backup, or
live-provider claim.
