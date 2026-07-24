# Production-Hardening Implementation Report

Prepared after implementation commits through `1ddc0cc` on 2026-07-24. This
report records repository capability, not provider permission, deployment
approval, or an unrecorded test result.

## Implemented phases

| Phase                          | Result                                                                                                                                                                                               | Representative commits                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Baseline/compliance            | immutable gap matrix and provider acquisition record                                                                                                                                                 | `0dc360c`                                                                   |
| Deterministic history/security | monotonic SQLite price observations; request/process hardening                                                                                                                                       | `f5e9019`, `5b975f3`                                                        |
| Providers/discovery            | fail-closed production provider config, eBay adapter, Grailed authorization reference gate, resilience, deterministic pagination/dedupe/SWR, exact money/card UX                                     | `60c4e64`, `612c6ee`, `b3d2a8a`                                             |
| PostgreSQL/worker              | schema/data plane, leases/checkpoints, authorized provider ingestion, request store, production request-path cutover, real-engine reliability gate, and serialized concurrent upserts                | `7e905ad`, `980fe77`, `8e20f79`, `1231945`, `4cbb56f`, `6d57f80`, `e732b53` |
| Accounts/product state         | durable engagement, persisted entitlements, account-token services/routes and web action flows, fragment-safe account links, in-app alert inbox/lifecycle                                            | `d3d2bcf`, `65f201f`, `9c5b45c`, `ef3b1eb`, `abad831`, `4c6ef4b`            |
| Intelligence                   | reproducible offline recommendation/fair-value pipeline and guarded recommendation runtime                                                                                                           | `0c4e3f3`, `24fa725`                                                        |
| Contracts/quality              | containers, PostgreSQL-backed CI/Playwright gates, portable backup and exact-target restore verification, production smoke, dependency/infrastructure checks, deployment runbooks, validated OpenAPI | `5c7a680`, `d7c35a7`, `9feaaf4`, `747789a`, `d73fd52`                       |
| Observability/critical flows   | redacted durable operations state, Prometheus metric families, and expanded browser critical-path coverage                                                                                           | `7d28837`, `1e2ec90`                                                        |
| Accessibility                  | axe-core WCAG A/AA browser scans and measured muted-text contrast correction                                                                                                                         | `99bb972`                                                                   |
| Final resilience/redaction     | persistent Grailed resilient client state and removal of raw exception/upstream messages from operational logs                                                                                       | `d4c22f7`, `ecbb66e`                                                        |
| Durable discovery/replay       | application-scoped provider runtime, server-owned discovered catalog, durable engagement rate/privacy boundary, freshness refresh, and crash-safe idempotent alert replay                            | `dd8eb33`                                                                   |
| Provider security              | canonical eBay/Grailed endpoint policy, manual redirect handling, same-origin Grailed bundle discovery, strict Algolia host construction, and malformed-row isolation                                | `c685d39`                                                                   |
| Currency/market correctness    | currency-scoped rules/ML preference signals plus current-state, per-segment sold-first, currency-partitioned observed analytics                                                                      | `8b5ae6b`, `1ddc0cc`                                                        |

## Important architectural decisions

- Production uses PostgreSQL; SQLite is local/test compatibility only.
- Migrations are checksummed forward changes with drift rejection.
- Price history uses a monotonic database observation version.
- Provider raw data remains adapter-private; partial provider failure is
  explicit and successful results survive.
- Credential-bearing provider requests are restricted to reviewed official
  origins. Redirects are not followed implicitly, and Grailed credential
  discovery cannot fetch cross-origin bundles or construct a host from an
  unvalidated application ID.
- Production mock activation/fallback is forbidden.
- Worker ingestion is a separate resumable process with database leases.
- Client-qualified durable events replace server-response impressions.
- Persisted entitlements replace usernames.
- Rules ranking and observed market ranges remain independent fallbacks.
- Application rollback keeps a forward-compatible schema; database restore is a
  separately approved recovery action.
- Operational endpoints expose bounded-cardinality aggregate state, never job
  payloads, cursors, provider metadata, credentials, or raw error messages.

See [DECISIONS.md](../DECISIONS.md).

## Schema and migration summary

PostgreSQL migrations `001` through `006` cover:

- users, verified identities, account tokens, sessions, settings
- canonical brands/aliases, listings/images/current state/transitions
- exact original/comparison/sold price observations and currency rates
- provider ingestion checkpoints/health/events and durable worker jobs/runs
- likes, recent/saved searches, filters, watchlists/preferences
- raw/catalog/per-user daily engagement
- alert matches/deliveries
- subscriptions, entitlements, billing webhook idempotency
- ML datasets/features/models/predictions and operational/audit records
- request-store hardening and per-user feature aggregates

The migration runner stores SHA-256 checksums in
`postgres_schema_migrations`, rejects drift, and uses a transaction per forward
migration. Readiness checks access plus expected migration state.

SQLite compatibility migrations run through `007_account_security`.

## Provider/compliance status

The full field-by-field record is the
[provider acquisition matrix](provider-acquisition-matrix.md).

| Source                                                    | Implementation                                        | Authorization                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| mock                                                      | deterministic fixtures                                | local/test only; prohibited in production                                                   |
| eBay                                                      | official Browse adapter complete for active inventory | blocked: production credentials, partner approval/agreements, and attribution config absent |
| Grailed                                                   | adapter, fixtures, active/sold normalization complete | blocked: exact written authorization and retained reference absent                          |
| Etsy, Depop, StockX, Vinted, Poshmark, Mercari, Vestiaire | researched; unsupported adapters not enabled          | blocked/unsupported as recorded in matrix                                                   |

Result: the target of two independently live authorized real providers is not
satisfied. No fixture is counted as live.

## Ingestion, engagement, alerts, and entitlements

The worker seeds active/sold provider searches only for active real providers,
claims leases, renews heartbeats, stores cursors/checkpoints, retries, upserts
observations idempotently, records state/price transitions, marks stale data,
rolls engagement features, and matches watchlists. Alert matching is replayed
after an ingestion crash even when the observation itself is an exact
idempotent duplicate; match and delivery uniqueness prevents double delivery.

The web/API record viewport-qualified impressions plus clicks, likes/unlikes,
search/filter/save/watchlist/recommendation events with event IDs and opaque
hashed privacy sessions. Aggregates feed recommendation features.

Premium analytics checks active persisted entitlements. A development admin
grant is disabled by default, requires verified admin identity, and is forbidden
in production. There is no billing provider.

In-app alerts support unseen/seen/dismissed state in the API and web inbox.
Delivery records support cadence, quiet hours, claim, retry, suppression, and
dead letter for a future outbound handler. In-app matches are immediate and are
not delayed by outbound digest/quiet-hour settings. Outbound email, push, and
SMS remain disabled.

## Account security

Production auth/session/saved/account routes use PostgreSQL. Passwords use
scrypt and a 12–128 character policy. Cookie mutations enforce trusted origins;
production requires secure cookies and secret peppers.

Verification, password reset, export, and deletion routes use purpose-bound,
pepper-hashed, superseding, expiring, one-time tokens. Reset revokes every
session. Export excludes credential/token hashes. Deletion checks exact username
and removes directly user-owned state; retained pseudonymous engagement loses
its user association under the current draft retention boundary.

The web app implements email/account controls, reset request/completion, email
verification, export download, and confirmed deletion. Activation blocker: no
transactional email provider/sender is configured, so action-link delivery is
disabled.

Generated action links keep the one-time token in the URL fragment so it is not
sent in the initial HTTP request. The client reads and immediately scrubs the
fragment.

## ML evaluation and active fallback

Recommendation fixture (8 users, K=5):

| Metric                       |  Rules | Hybrid |
| ---------------------------- | -----: | -----: |
| Recall                       | 0.0000 | 0.8750 |
| NDCG                         | 0.0000 | 0.7577 |
| MAP                          | 0.0000 | 0.7188 |
| Coverage                     | 0.3889 | 0.9444 |
| Diversity                    | 0.8938 | 0.8375 |
| Novelty                      | 2.3965 | 3.0027 |
| Provider concentration (HHI) | 0.3350 | 0.3400 |
| Brand concentration (HHI)    | 0.2250 | 0.1763 |

The candidate is not promoted: it has one synthetic snapshot, too few users,
and diversity regresses beyond the allowed gate. API default is `disabled`;
shadow returns rules and bounded comparison metadata. Active requires both a
promoted artifact and explicit approval.

The two-user cold-start slice recorded hybrid Recall@5 `0.5000`, NDCG@5
`0.2153`, MAP@5 `0.1250`, and diversity `0.7850`; the slice is far too small for
a production-quality conclusion.

Fair-value fixture (6 future sold rows):

| Metric                | Observed median |   Ridge |
| --------------------- | --------------: | ------: |
| MAE, minor units      |           4,500 |   5,623 |
| Median absolute error |           4,500 |   5,977 |
| MAPE                  |         11.143% | 13.832% |
| Interval coverage     |          0.0000 |  0.1667 |

The model is worse than baseline and under-calibrated. Observed comparable
ranges remain active; confirmed sold observations are preferred independently
inside each brand/category and currency segment, asking fallback is labeled, and
currencies remain separate. Candidate segment MAE was `5,087`
for Maison Margiela/shoes, `6,366.5` for Prada/bags, and `5,415.5` for Rick
Owens/jackets; each segment is synthetic and sparse.

## Verification design

Phase work recorded focused typecheck/lint/build and provider/API/web/ML/worker
test passes. The deterministic price regression freezes/reuses a timestamp and
asserts repeated changes order by the monotonic database key. Browser coverage
includes signed-out discovery, signed-in onboarding/likes, watchlist
create-edit-delete, free-account analytics authorization, provider degradation,
session revocation, and PostgreSQL account deletion/session invalidation.
Infrastructure static validation is available.

The observability phase recorded API typecheck/lint passes, 51 focused tests,
and 204 API tests passing before its commit. A later ephemeral PostgreSQL 17.10
run then recorded:

- root `db:migrate` applying migrations `001`–`006`
- all five real-engine reliability tests passing in five consecutive focused
  runs; the first run exposed a listing primary-key race, fixed in `e732b53`
  with a per-listing transaction advisory lock
- full API suite `209/209` with the real-engine gate enabled
- PostgreSQL-backed Playwright `7/7`
- custom-format backup, checksum verification, and isolated restore with
  migration ledger count/max version `6`
- focused axe-core browser scans `2/2`; the local expanded Playwright suite then
  passed eight cases and skipped only the PostgreSQL-only deletion case
- full provider suite `45/45`, focused API runtime/registry `8/8`, and
  provider/API lint/typecheck after Grailed moved to one persistent resilient
  client per provider lifetime
- web component suite `58/58` plus the focused browser action-link flow after
  fragment consumption/scrubbing was aligned with generated email URLs

These targeted results do not replace the pending final-SHA root-command table
below.

After that drill, restore hardening added a fail-closed
`current_database() === RESTORE_TARGET_DATABASE` check before any `--clean`
operation, so the human confirmation and connected target cannot diverge.

CI defines:

- frozen install, formatting, lint, typecheck, build, unit/contract, dependency
  audit
- PostgreSQL 17 clean migration, prior-schema upgrades, concurrent idempotent
  writes, transaction rollback, lease contention, session revocation, logical
  backup, and isolated restore
- PostgreSQL-backed Playwright plus the local hermetic compatibility mode
- Compose configuration/build/boot and health/no-mock checks

Evidence limitation: this workstation has no Docker, so no local Compose claim
is made. The isolated logical restore was not an encrypted off-host,
managed-HA/PITR, production incident cutover. No authorized live-provider or
HTTPS staging claim is made.

## Final command results — pending parent verification

Do not replace `PENDING` with a pass unless the command completed successfully
against the final SHA. Record skips and environment-gated coverage explicitly.

| Required command                          | Final result                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `corepack pnpm install --frozen-lockfile` | PENDING                                                                             |
| `corepack pnpm format:check`              | PENDING                                                                             |
| `corepack pnpm lint`                      | PENDING                                                                             |
| `corepack pnpm typecheck`                 | PENDING                                                                             |
| `corepack pnpm build`                     | PENDING                                                                             |
| `corepack pnpm test`                      | PENDING                                                                             |
| `corepack pnpm test:integration`          | PENDING                                                                             |
| `corepack pnpm test:e2e`                  | PENDING                                                                             |
| `corepack pnpm db:migrate`                | PENDING — requires `DATABASE_URL`                                                   |
| `corepack pnpm smoke:test`                | PENDING — requires an explicit deployed API URL and authorized provider expectation |

Five consecutive clean full-suite runs: **PENDING**.

Release-environment evidence still to attach: real-PostgreSQL CI URL/artifacts,
Compose boot, encrypted isolated restore, and authorized no-mock staging smoke.

## Remaining external blockers

1. eBay production approval/credentials/attribution.
2. Grailed written permission/reference.
3. Authorized second live provider.
4. Transactional email provider and sender domain.
5. Billing provider and signed webhook configuration.
6. Approved live exchange-rate source.
7. Adequate privacy-reviewed temporal engagement and confirmed-sold datasets for
   ML promotion.
8. HTTPS no-mock staging environment and retained smoke evidence.

## Remaining internal/deployment work

- finish decomposing the oversized API dispatcher and web application
  composition modules
- replace process-local rate limiting/provider cache before unrestricted
  horizontal scale
- implement and test an approved external error-tracking exporter plus
  dashboards/alerts
- approve and enforce retention/deletion schedules; test database service
  restart, Compose, encrypted off-host restore, managed HA/PITR, and capacity
  plans

## Deployment

1. Complete the [deployment checklist](runbooks/deployment-checklist.md).
2. Capture a fresh encrypted backup and isolated restore evidence.
3. Build immutable API/worker/web images.
4. Run the migration job once and verify versions `001`–`006`.
5. Deploy worker, inspect active/blocked provider IDs and checkpoints.
6. Canary API; verify PostgreSQL/migration/provider readiness.
7. Deploy web built for the correct HTTPS API origin.
8. Run `corepack pnpm smoke:test` with the deployed API URL and expected
   authorized provider IDs.
9. Observe provider, database, worker, alert, engagement, and ML fallback metrics.

## Rollback

Pause rollout/scheduling, preserve evidence, and return API/worker/web to previous
immutable digests. Keep the forward-compatible schema. Correct migration defects
with a new forward migration. Restore only for confirmed loss/corruption after
scratch validation, incident approval, and a final forensic backup when
possible.

See [Production deployment](runbooks/PRODUCTION_DEPLOYMENT.md),
[Production rollback](runbooks/PRODUCTION_ROLLBACK.md), and
[PostgreSQL backup/restore](runbooks/POSTGRES_BACKUP_RESTORE.md).
