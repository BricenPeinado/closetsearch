# QA Baseline

## Purpose

This document separates executable repository coverage from release evidence.
The presence of a test or CI job is not a claim that the final current commit has
passed every gate.

## Automated coverage

### Providers and discovery

- mock/eBay/Grailed fixture normalization
- malformed/partial payload, credential-egress, redirect, and unsafe URL
  handling
- capability rejection
- page/cursor continuation, stable merge, cross-page/provider dedupe
- timeout, rate limit/`Retry-After`, retry, pacing, circuit, fresh/stale cache
- production no-mock configuration
- listing card, image fallback, filtering, URL persistence, and pagination

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

This is not a final-release attestation. Re-run all commands after the last
merged change and record five consecutive full-suite passes. Do not combine
separate focused runs into a claim that one final SHA passed everything.

## Environment limitations

Docker is not installed on this workstation. Local validation covers static
Compose/Dockerfile contracts, shell syntax, `pg-mem`, an ephemeral PostgreSQL
17.10 engine, hermetic and PostgreSQL-backed Playwright, and an unencrypted
isolated logical restore. It does not cover:

- a local Compose boot
- a PostgreSQL service restart across the critical persistence flows
- an encrypted off-host restore drill or managed HA/PITR
- a live authorized provider
- HTTPS staging behavior

Use CI or an equipped staging environment and retain run URLs/artifacts.

## Release-critical manual checks

- keyboard and screen-reader navigation, visible focus, contrast, mobile layout
- image failure, empty/retry/partial/stale/offline/session-expired states
- account verification/reset/export/deletion with real configured email
- persisted entitlement versus free/expired/revoked access
- worker restart, database restart, watchlist/inbox lifecycle
- provider outage/rate limit and explicit no-mock behavior
- analytics sold/asking basis, sample/currency/freshness/disclaimers
- deployment canary, metrics, backup/restore, and rollback
