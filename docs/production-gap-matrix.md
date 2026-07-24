# Production Gap Matrix

Audited from the repository state at `fb0d117` on 2026-07-24. This is the
pre-implementation baseline for the production-hardening program.

Status meanings:

- **working**: implemented and supported by executable evidence at the current scope
- **partial**: useful implementation exists but does not meet the production target
- **placeholder**: a product or code surface exists but its underlying behavior is not real
- **missing**: no implementation exists
- **blocked**: safe internal work can continue, but activation requires external approval,
  credentials, configuration, or data

| Planned feature | Status | Relevant files | Required implementation | Verification |
| --- | --- | --- | --- | --- |
| Provider acquisition and compliance record | missing | `docs/marketplace-notes/GRAILED.md`, `docs/runbooks/PROVIDERS.md` | Maintain the source-by-source approval, permitted-use, retention, attribution, robots, rate-limit, and authorization record in `provider-acquisition-matrix.md`; fail closed when proof is absent | Documentation review plus production config tests that keep unapproved providers inactive |
| Grailed live acquisition | blocked | `packages/providers/src/grailed/*`, `apps/api/src/providers/*` | Retain the fixture adapter, but disable live HTML/JS credential discovery and undocumented Algolia access unless written consent covers the exact request, retention, analytics, and ML profile | Fixture contract suite; separate credentialed staging smoke only after an authorization reference is configured |
| Second authorized real provider | blocked | No adapter exists | Implement eBay Browse behind official OAuth and partner approval; keep it disabled without credentials/approval. Etsy may follow only within approved data-use scope | Recorded fixtures and stub-server contract/chaos tests; non-mock staging smoke after approval |
| Provider contract and normalization | partial | `packages/providers/src/types.ts`, `packages/shared/src/domain/listing.ts`, `listing-sanitizer.ts` | Add exact money, images, seller/shipping support flags, lifecycle, timestamps, freshness, attribution, analytics eligibility, retry metadata, and strict URL/currency validation without leaking raw types | Shared provider conformance suite covering complete, partial, malformed, and hostile payloads |
| Provider resilience, pagination, cache, and dedupe | partial | `apps/api/src/providers/orchestrator.ts`, `runtime-config.ts`, `registry.ts` | Process-stable clients, bounded concurrency, pacing, `Retry-After`, exponential backoff, circuit breaker, latency/health metrics, bounded stale-while-revalidate cache, conservative cross-provider fingerprints, stable tie-breaks, and per-provider continuation/degraded state | Deterministic multi-provider pagination tests plus 429/5xx/timeout/circuit/cache-stampede tests |
| Production mock isolation | partial | `runtime-config.ts`, `registry.ts`, provider UI copy | Make production reject mock activation and silent fallback; label fixture inventory as mock in every environment | Startup/config tests and a staging smoke test that fails if any mock listing or provider is active |
| Scheduled ingestion and listing lifecycle | missing | Feed/search side effects in `feed-service.ts`, `search-service.ts` | Add a separate resumable worker, database leases, schedules, checkpoints, idempotent listing upserts, price changes, stale/sold/removed state transitions, watchlist matching, and job/provider status | Worker resume, duplicate ingestion, lease contention, lifecycle, and restart tests |
| Normalized exact money and FX | partial | `listing.ts`, `analytics.ts`, price-snapshot schema/repository | Store integer minor units; distinguish original, comparison, display, shipping, and landed prices; persist rate source/time and never relabel unconverted money | Deterministic rate-fixture, stale-rate, unsupported-currency, rounding, sort, and migration tests |
| Listing cards and discovery UX | partial | `apps/web/src/components/listing-card.tsx`, `apps/web/src/app.tsx`, `styles.css` | Local image fallback, aspect reservation, unknown brand, original/display prices, status/freshness, supported seller/shipping fields, marketplace CTA, qualified analytics, IntersectionObserver paging with button fallback, scroll restoration, complete URL filters, and explicit partial/stale/session states | DOM/axe component tests and Playwright mobile, keyboard, paging, back-navigation, offline, and degraded-provider flows |
| PostgreSQL production persistence | missing | `apps/api/src/db/*` | Replace the synchronous process-local SQLite production path with pooled PostgreSQL repositories behind interfaces; add constraints, indexes, transactions, timeouts, transient retries, checksummed migrations, drift detection, retention, backup, and restore | Clean/upgrade migrations, real PostgreSQL integration tests, query-plan review, concurrent upserts, rollback, restart, backup/restore |
| Deterministic price history | partial | `004_price_snapshots.sql`, `price-snapshots.ts`, `priceSnapshotService.test.ts` | Add a database monotonic observation/version key and order explicitly by it instead of timestamps/UUIDs | Freeze the clock, write repeated same-timestamp changes, and assert the final write is latest over repeated runs |
| Durable engagement events | placeholder | `engagementService.ts`, `feed-service.ts`, `search-service.ts` | Remove server-response “impressions”; ingest deduped client viewport-duration, click, like/unlike, search, filter, save, watchlist, hide, and ranked-position events; aggregate features outside feed requests | Event-ID/session dedupe, minimum-view-duration, restart, retention, privacy deletion, and “response is not an impression” tests |
| Rules recommendation fallback | partial | `recommendationService.ts`, `personalizationSignalsService.ts` | Preserve it for cold start/failure; make money features currency-safe, ignore disabled intent, rank from durable active candidates, and retain diversity/explanations | Deterministic cold-start, currency, diversity, provider/brand concentration, and timeout fallback tests |
| ML recommendations | missing | No ML package exists | Reproducible temporal snapshots/splits, implicit-feedback or learning-to-rank training, content fallback, schema/artifact versions, deterministic seeds, shadow rollout, timeout fallback, and safe reasons | Leakage/data validation; deterministic training smoke; Recall/NDCG/MAP, coverage, diversity, novelty, concentration, and latency report |
| Observed market analysis | partial | `analyticsService.ts`, `marketRangeService.ts`, price snapshots | Scheduled active/sold observations, sold-vs-asking separation, currency-safe grouping, canonical features, exclusions, robust outliers, minimum samples, freshness/source coverage, and safe language | Mixed-currency, sold-priority, outlier, sample-gate, freshness, and source-coverage tests |
| ML fair-value analysis | missing | No model/dataset boundary exists | Versioned comparable dataset, temporal/segment validation, fair-value model, calibrated interval, drift/staleness checks, prediction metadata, and observed-range fallback | MAE, median absolute error, valid percentage error, interval coverage, sample counts, segment metrics, and stale-model fallback |
| Premium entitlements and billing | placeholder | `premiumAccessService.ts`, analytics routes/UI | Replace reserved usernames with persisted provider-neutral entitlements; add admin audit path; keep billing disabled unless signed webhook credentials are configured | Restart, expiry/revocation, authorization, idempotent webhook, and signature tests |
| Watchlist monitoring and alert inbox | partial | watchlist/alert repositories and services, profile UI | Worker matching for new/changed listings, idempotent matches, seen/dismissed lifecycle, frequency/quiet hours, attempts, retries/dead letters; email only with verified address/provider | Matching/resume/dedupe, quiet-hours, retry/DLQ, inbox state, and disabled-channel tests |
| Account recovery and verification | partial | `apps/api/src/auth/*`, `user-service.ts`, auth UI | Verified identities, hashed one-time short-lived verification/reset tokens, session revocation, auth rate limits, CSRF protection, secure production config, password/breach policy, export/delete | Expiry/reuse/revocation, CSRF, rate-limit, cookie, spoofed-user, export, and deletion tests |
| API maintainability and security | partial | `apps/api/src/app.ts` (1,516 lines), `logger.ts`, `server.ts` | Split domain routes; body limits; schemas; consistent errors; headers; rate limits; request IDs; sensitive-key redaction; OpenAPI; graceful startup/shutdown | API contract/OpenAPI validation, oversized-body/security/log-redaction tests, SIGTERM integration |
| Web maintainability | partial | `apps/web/src/app.tsx` (4,220 lines) | Extract route/features/hooks by domain without changing URLs or external behavior | Existing regression tests plus route-level component and Playwright coverage |
| Automated quality gates and CI | partial | package tests, root `package.json`; no workflow or E2E harness | Add formatting, PostgreSQL integration, Playwright, accessibility/security/dependency checks, migration service, and no-live-provider CI guard | Every required root command plus five consecutive clean full-suite runs |
| Deployment and observability | missing | `server.ts`, current beta runbooks; no containers/compose | Reproducible web/API/worker/PostgreSQL processes, startup env validation, liveness/readiness, graceful drain, metrics, error hook, backup/restore, deploy migration and automated rollback checks | Clean compose boot, dependency-failure probes, metrics scrape, restart, restore drill, and staging smoke |
| Documentation and roadmap truthfulness | partial | root docs, stale app/package READMEs, `TASKS.md`, runbooks | Record production/blocked/deferred status, provider decisions, DB/worker/ML operations, model cards/evaluation, incidents, backup evidence, deploy/rollback, and exact activation blockers | Documentation review tied to executable evidence and release checklist |

## Baseline executable evidence

- `corepack pnpm install --frozen-lockfile`: passed.
- `corepack pnpm lint`, `typecheck`, `build`, and `test`: passed once.
- Current suite: 157 tests (31 provider, 34 web, 92 API); the shared package has
  no tests.
- `corepack pnpm format:check`: missing.
- `corepack pnpm test:integration` and `test:e2e`: missing.
- The first isolated repeat of `priceSnapshotService.test.ts` failed: two price
  changes shared a timestamp and the older `180 USD` observation was selected
  instead of the later `140 USD` observation.
- There is no CI workflow, PostgreSQL integration harness, browser harness,
  worker process, container/compose definition, or ML package.

## Reviewable implementation phases

1. Compliance and provider foundation: fail-closed production config, expanded
   normalized contracts, resilient orchestration, official-provider adapters and
   contract fixtures.
2. Data foundation: exact money/FX, PostgreSQL, checksummed migrations,
   deterministic observations, persistent listing lifecycle, worker leases and
   ingestion.
3. Product reliability: durable engagement, entitlements, account recovery,
   watchlist alert lifecycle, API security/refactor, and normalized listing UX.
4. Intelligence: reproducible recommendation and market-analysis pipelines,
   shadow evaluation, model metadata, uncertainty, and rules/observed fallbacks.
5. Operations and release: integration/E2E/security/accessibility suites,
   containers, CI, metrics, backup/restore drill, staging smoke, and truthful
   runbooks/roadmap.

No phase is complete until its listed verification is executable and passing.
