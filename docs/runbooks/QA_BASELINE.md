# QA Baseline

## Purpose

This document separates executable repository coverage from release evidence.
The presence of a test or CI job is not a claim that the final current commit has
passed every gate.

## Automated coverage

### Providers and discovery

- mock/eBay/Grailed/Depop/Yahoo! Auctions Japan/Mercari Japan fixture
  normalization, including original Japanese text, marketplace limitations,
  auctions, current bids, and completed evidence
- malformed/partial payload, credential-egress, redirect, and unsafe URL
  handling
- capability rejection
- page/cursor continuation, stable merge, cross-page/provider dedupe
- timeout, rate limit/`Retry-After`, retry, pacing, circuit, fresh/stale cache
- production no-mock configuration
- listing card, image fallback, filtering, URL persistence, and pagination
- listing detail/deep-link behavior and exact-currency price-history/trend
  summaries, provider/date filters, sparse data, outlier counts, and cautious
  descriptive language

### Persistence and worker

- PostgreSQL migration idempotency/checksum drift
- transaction rollback and transient retry
- concurrent/idempotent listing upsert
- restart semantics
- monotonic same-timestamp price history
- job lease contention/renewal/failure/resume/checkpoint
- provider ingestion lifecycle/watchlist match
- production request store, sessions, account tokens, saved features
- engagement/event dedupe and alert lifecycle
- migration `007` listing dimensions, typed price evidence, per-watchlist alert
  policy, phone/consent/suppression/webhook state, and outbound delivery attempts
- email/SMS worker delivery-time consent/suppression enforcement, idempotency,
  retry/dead-letter, Resend/Twilio transport failure redaction, and
  unsubscribe/STOP/START/HELP handling

Fast repository integration tests use `pg-mem`. A separately gated suite uses
`POSTGRES_INTEGRATION_DATABASE_URL` to verify upgrade from every prior schema,
real concurrent upserts/rollback, unchanged-listing freshness, lease
contention, and session revocation. CI runs that suite, the migration CLI, and
logical backup/restore on PostgreSQL 17.

### Security and API

- signup/login/logout/session expiry/revocation
- origin/CSRF, body limits, rate limits, secure production startup
- spoofed user IDs
- email verification/reset/export/deletion token lifecycle
- entitlement authorization
- request IDs, security headers, redaction, readiness, graceful close
- OpenAPI path/method/schema/security contract
- operations bearer authorization for metrics/status/provider health
- Resend raw-body Svix verification/clock-skew/replay dedupe and Twilio callback
  URL signature verification/replay dedupe
- phone verification rate limits, hashed challenge/consent/destination data, and
  verified-destination readiness

### ML

- snapshot data validation and temporal leakage rejection
- deterministic training/artifact fingerprint
- cold-start and diversity reranking
- offline recommendation metrics/promotion gates
- asking-price target leakage prohibition
- fair-value outliers, interval, drift/staleness, observed fallback
- guarded runtime invalid/stale/timeout/failure fallback

### Browser

Playwright covers signed-out, signed-in/onboarding, provider-degraded,
revoked-session recovery, account, alert, analytics, and restart-sensitive
flows. Local default is hermetic mock/SQLite; CI runs the browser API against
PostgreSQL while still using clearly labeled mock inventory. A
provider-authorized staging smoke is separate and cannot use fixtures.

New browser specs add:

- a signed-in saved-search, recommendation, and like-suppression journey
- login/logout plus fragment-safe one-time password reset
- verified email/SMS settings through alert inbox to exact listing detail
- portable account-export and confirmed-deletion UI handoffs
- desktop sidebar versus touch filter drawer behavior
- Japanese auction detail, original/translated copy, proxy limitations, typed
  price evidence, chart semantics, and axe-core scan

These are coverage descriptions, not pass claims. The notification journey
intercepts API responses and does not prove Resend/Twilio delivery. Durable
detail/trend/delivery behavior must still run against migration `007`; a SQLite
unavailable response is expected, not proof of production behavior.

The web artifact also contains a generated 1200×630
`apps/web/public/closetsearch-og.png` wired into Open Graph/Twitter metadata.
Release QA must fetch the deployed HTTPS metadata/image, review alt text and
copy, check crop/readability at small previews, and retain target-unfurler
screenshots. File presence is not deployed-preview evidence.

`tests/e2e/accessibility.spec.ts` runs axe-core WCAG 2 A/AA scans over signed-out
Home/Login and signed-in Profile/Alerts. Its first run found the shared
muted-label contrast at 3.08–3.30:1; the corrected token measured at least 5.16:1
against the application background. The focused scans passed `2/2`; the local
SQLite Playwright run passed eight tests and skipped only the PostgreSQL-only
account-deletion case.

## Required commands

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
corepack pnpm test:integration
corepack pnpm test:e2e
corepack pnpm db:migrate
corepack pnpm smoke:test
```

`db:migrate` is the PostgreSQL production command. SQLite compatibility uses
`db:migrate:sqlite` and `db:seed:sqlite`.

## Recorded phase evidence

During the production-hardening passes, focused provider/API/web/ML/worker
suites, typecheck, lint, build, and infrastructure static validation passed at
their respective commits. An ephemeral PostgreSQL 17.10 run then passed the five
real-engine reliability cases five consecutive times, the full API suite
(`209/209`), PostgreSQL-backed Playwright (`7/7`), migrations `001`–`006`, and a
checksummed isolated logical restore. The same-timestamp price regression was
reproduced before the fix and its monotonic-sequence regression passed
afterward.

Historical baseline commit `3072b33` subsequently passed five independent consecutive
root suites with the real-PostgreSQL gate enabled. Each run passed shared `2/2`,
ML `19/19`, providers `51/51`, web `31/31`, and API `223/223`. The explicit
integration suite passed `45/45` and PostgreSQL-backed Playwright passed `10/10`
before and after a database-process restart. The production smoke remains
externally blocked and correctly refuses a local/mock default.

That historical evidence predates the current Depop, Yahoo! Auctions Japan,
Mercari Japan, migration `007`, listing-detail, price-trend, and email/SMS
changes. The 2026-07-26 final working-tree run separately passed `445/445`
root tests with all six real-PostgreSQL tests enabled, `45/45` explicit
integration tests, and `20/20` PostgreSQL-backed Playwright cases across
desktop/mobile/tablet. Migration `007`, an isolated custom-format restore, and
a database-process restart each retained a `7/7` migration ledger. Five
consecutive final-SHA suites, CI artifacts, and live staging evidence are still
required for public-launch approval.

## Environment limitations

Docker is not installed on this workstation. Local validation covers static
Compose/Dockerfile contracts plus current real-PostgreSQL migration,
integration, restart, and isolated-restore evidence. The current environment
cannot claim:

- a local Compose boot
- an encrypted off-host restore drill or managed HA/PITR
- a live authorized provider
- HTTPS staging behavior
- production Resend/Twilio delivery or webhook callbacks
- Sites-to-API wiring when `CLOSETSEARCH_API_ORIGIN` is not configured
- a local dependency audit: the managed environment blocks sending dependency
  metadata outbound, so use approved CI

Use CI or an equipped staging environment and retain run URLs/artifacts.

## Release-critical manual checks

- keyboard and screen-reader navigation, visible focus, contrast, mobile layout
- image failure, empty/retry/partial/stale/offline/session-expired states
- account verification/reset/export/deletion with real configured email
- explicit email/SMS opt-in, phone verification, per-watchlist channels,
  unsubscribe/STOP/START/HELP, bounce/failure suppression, and consent
  revalidation with configured staging transports
- listing-detail shared URLs, original Japanese content, auction distinctions,
  and price-trend currency/evidence/caveat behavior on PostgreSQL
- persisted entitlement versus free/expired/revoked access
- worker restart, database restart, watchlist/inbox lifecycle
- provider outage/rate limit and explicit no-mock behavior
- analytics sold/asking basis, sample/currency/freshness/disclaimers
- deployment canary, metrics, backup/restore, and rollback
- authenticated operations probes and Sites API-origin routing
- generated Open Graph/Twitter card dimensions, deployed URL resolution,
  alt/copy/crop/readability, cache refresh, and target social-preview rendering
