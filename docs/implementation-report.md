# Production-Hardening Implementation Report

Reconciled with the working tree on 2026-07-26. The historical baseline was
implemented through `3072b33` on 2026-07-24; current five-provider,
price-intelligence, listing-detail, and outbound-notification changes are newer
and do not inherit that commit's release evidence. This report records
repository capability, not provider permission, configured credentials,
deployment approval, or an unrecorded test result.

## Implemented phases

| Phase                          | Result                                                                                                                                                                                                 | Representative commits                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Baseline/compliance            | immutable gap matrix and provider acquisition record                                                                                                                                                   | `0dc360c`                                                                   |
| Deterministic history/security | monotonic SQLite price observations; request/process hardening                                                                                                                                         | `f5e9019`, `5b975f3`                                                        |
| Providers/discovery            | fail-closed production provider config, eBay adapter, Grailed authorization reference gate, resilience, deterministic pagination/dedupe/SWR, exact money/card UX                                       | `60c4e64`, `612c6ee`, `b3d2a8a`                                             |
| PostgreSQL/worker              | schema/data plane, leases/checkpoints, authorized provider ingestion, request store, production request-path cutover, real-engine reliability gate, and serialized concurrent upserts                  | `7e905ad`, `980fe77`, `8e20f79`, `1231945`, `4cbb56f`, `6d57f80`, `e732b53` |
| Accounts/product state         | durable engagement, persisted entitlements, account-token services/routes and web action flows, fragment-safe account links, in-app alert inbox/lifecycle                                              | `d3d2bcf`, `65f201f`, `9c5b45c`, `ef3b1eb`, `abad831`, `4c6ef4b`            |
| Intelligence                   | reproducible offline recommendation/fair-value pipeline and guarded recommendation runtime                                                                                                             | `0c4e3f3`, `24fa725`                                                        |
| Contracts/quality              | containers, PostgreSQL-backed CI/Playwright gates, portable backup and exact-target restore verification, production smoke, dependency/infrastructure checks, deployment runbooks, validated OpenAPI   | `5c7a680`, `d7c35a7`, `9feaaf4`, `747789a`, `d73fd52`                       |
| Observability/critical flows   | redacted durable operations state, Prometheus metric families, and expanded browser critical-path coverage                                                                                             | `7d28837`, `1e2ec90`                                                        |
| Accessibility                  | axe-core WCAG A/AA browser scans and measured muted-text contrast correction                                                                                                                           | `99bb972`                                                                   |
| Final resilience/redaction     | persistent Grailed resilient client state and removal of raw exception/upstream messages from operational logs                                                                                         | `d4c22f7`, `ecbb66e`                                                        |
| Durable discovery/replay       | application-scoped provider runtime, server-owned discovered catalog, durable engagement rate/privacy boundary, freshness refresh, and crash-safe idempotent alert replay                              | `dd8eb33`                                                                   |
| Provider security              | canonical eBay/Grailed endpoint policy, manual redirect handling, same-origin Grailed bundle discovery, strict Algolia host construction, and malformed-row isolation                                  | `c685d39`                                                                   |
| Currency/market correctness    | currency-scoped rules/ML preference signals plus current-state, per-segment sold-first, currency-partitioned observed analytics                                                                        | `8b5ae6b`, `1ddc0cc`                                                        |
| Release truth/toolchain        | truthful readiness docs, workspace formatting, and patched Babel/esbuild transitive build tooling                                                                                                      | `b572008`, `3072b33`                                                        |
| Five-marketplace adapters      | Depop, Yahoo! Auctions Japan, and Mercari Japan join eBay and Grailed with fixtures, strict origins, authorization gates, pagination, typed marketplace semantics, and fail-closed runtime wiring      | `b3fb9a7`                                                                   |
| Product intelligence           | durable listing detail, original-language marketplace content, typed exact-currency price evidence, trend statistics, accessible chart UI, and PostgreSQL migration `007`                              | `b3fb9a7`                                                                   |
| Notification delivery          | explicit email/SMS consent/readiness, Resend/Twilio transports, worker delivery, unsubscribe/STOP handling, signed deduplicated webhooks, and suppression                                              | `b3fb9a7`                                                                   |
| Product presentation           | high-contrast resale-market “signal desk” system across product/search/detail surfaces, responsive two-to-five-column discovery, accessible touch/focus behavior, and a generated 1200×630 social card | `b3fb9a7`; owner-only Sites version 2 frontend verified                     |

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
- Operational status, provider health, and metrics are bearer-protected in
  production and whenever a token is configured.
- Email and SMS are opt-in channels. Transport configuration cannot override a
  missing verified destination, current consent, per-watchlist enablement, or
  suppression.

See [DECISIONS.md](../DECISIONS.md).

## Schema and migration summary

PostgreSQL migrations `001` through `007` cover:

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
- durable listing descriptions/original-language and translated fields,
  marketplace limitations, material/color/model/item-family/region dimensions,
  typed asking/current-bid/completed-auction/confirmed-sold observations, and
  trend indexes
- per-watchlist event/channel settings, explicit email/SMS consent history,
  phone verification, destination suppression, webhook-event dedupe, and richer
  delivery-attempt metadata

The migration runner stores SHA-256 checksums in
`postgres_schema_migrations`, rejects drift, and uses a transaction per forward
migration. Readiness checks access plus expected migration state.

SQLite compatibility migrations run through `007_account_security`.

## Provider/compliance status

The full field-by-field record is the
[provider acquisition matrix](provider-acquisition-matrix.md).

| Source                   | Implementation                                                     | Authorization                                                                                   |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| mock                     | deterministic fixtures                                             | local/test only; prohibited in production                                                       |
| eBay                     | official Browse adapter for active inventory                       | blocked: production credentials, partner approval/agreements, and attribution config absent     |
| Grailed                  | active/sold adapter and fixtures                                   | operator attested permission; blocked until a durable provider-specific reference is configured |
| Depop                    | adapter, fixtures, pagination, filters, and normalization          | operator attested permission; blocked until a durable provider-specific reference is configured |
| Yahoo! Auctions Japan    | auction adapter, fixtures, bids/end-time and JP-language semantics | operator attested permission; blocked until a durable provider-specific reference is configured |
| Mercari Japan            | adapter, fixtures, market-state and JP-language semantics          | operator attested permission; blocked until a durable provider-specific reference is configured |
| other researched sources | unsupported and not enabled                                        | blocked/unsupported as recorded in the acquisition matrix                                       |

All five requested adapters are implemented. Zero are activation-ready or
configured live in this checkout, and no fixture counts as live evidence.

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
Email and SMS now have fail-closed Resend and Twilio transport implementations,
an `alerts.deliver_due` worker job, idempotency keys, retry/dead-letter state,
delivery-time consent and suppression checks, and verified-destination
readiness. Resend webhooks verify the raw-body Svix signature and deduplicate
provider event IDs; Twilio webhooks verify the public callback URL signature,
deduplicate events, handle STOP/START/HELP, and suppress failed destinations.
Email has signed one-click unsubscribe links. Global and per-watchlist email/SMS
flags default off; in-app remains immediate and does not wait for quiet hours.

The repository does not contain production Resend/Twilio credentials, verified
senders/numbers, webhook secrets, public callback origin, user consent, or
staging delivery evidence. Therefore outbound delivery remains inactive.

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
verification, export download, and confirmed deletion. Account-action email can
use the configured Resend transport. Activation remains blocked until an
approved Resend account, verified sender/domain, API key, webhook secret, and
public HTTPS account-action origin are configured and exercised in staging.

Generated action links keep the one-time token in the URL fragment so it is not
sent in the initial HTTP request. The client reads and immediately scrubs the
fragment.

## Listing detail and price intelligence

Public `GET /listings/:listingId` and
`GET /listings/:listingId/price-trends` (with `/price-history` compatibility)
read normalized durable PostgreSQL state. Detail responses include original and
translated marketplace content, product dimensions, seller/shipping context,
marketplace limitations, auction state, and attribution without exposing raw
provider payloads.

Trend responses use integer minor units and one currency at a time. Evidence is
typed as asking, current bid, completed auction, or confirmed sold; incomplete
auctions are never inferred as sales. Statistics include sample size,
freshness, confidence, quartiles/outlier counts, and 7/30/90/365-day changes
with optional provider/date filters. The UI labels sparse or asking-only
evidence and does not present a prediction, guarantee, or cross-currency
comparison. Both routes fail honestly outside PostgreSQL and require migration
`007`.

The web artifact includes `apps/web/public/closetsearch-og.png` (1200×630) and
wires it into Open Graph/Twitter metadata. That is implementation evidence only;
the final release still needs an HTTPS crawler fetch, metadata/alt/copy review,
and target link-unfurler screenshots.

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

These targeted results are historical phase evidence. They do not cover the
current five-provider, migration `007`, listing-detail, price-trend, or outbound
notification changes.

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
is made. The isolated logical restore was not encrypted or off-host and was not
a managed-HA/PITR or production-incident cutover. No authorized live-provider
or HTTPS staging claim is made.

## Historical baseline command results

The following ran on implementation commit `3072b33`. PostgreSQL commands used
an ephemeral local PostgreSQL 17.10 instance, not `pg-mem`. They are retained as
baseline history and must not be represented as final evidence for the current
working tree.

| Required command                          | Final result                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `corepack pnpm install --frozen-lockfile` | PASS — lockfile current                                                                                                                                                  |
| `corepack pnpm format:check`              | PASS                                                                                                                                                                     |
| `corepack pnpm lint`                      | PASS — all five code workspaces                                                                                                                                          |
| `corepack pnpm typecheck`                 | PASS — all five code workspaces                                                                                                                                          |
| `corepack pnpm build`                     | PASS — shared, ML, providers, web, and API                                                                                                                               |
| `corepack pnpm test`                      | PASS in five independent consecutive invocations — each: shared `2/2`, ML `19/19`, providers `51/51`, web `31/31`, API `223/223`, including real-PostgreSQL `6/6`        |
| `corepack pnpm test:integration`          | PASS — `45/45`, including migrations/upgrades, concurrent upserts, rollback, freshness, lease contention, sessions, worker replay, request state, account, and analytics |
| `corepack pnpm test:e2e`                  | PASS — PostgreSQL mode `10/10`; repeated `10/10` after an actual PostgreSQL stop/start                                                                                   |
| `corepack pnpm db:migrate`                | PASS — no pending migrations, current version `6`                                                                                                                        |
| `corepack pnpm smoke:test`                | BLOCKED/EXPECTED FAIL-CLOSED — no `CLOSETSEARCH_API_BASE_URL`; the command refused to default to local or mock inventory                                                 |

Additional baseline gates recorded:

- `corepack pnpm deps:check`: no known vulnerabilities
- `corepack pnpm infrastructure:check`: all 13 static infrastructure contracts
- custom PostgreSQL backup/checksum/isolated restore: PASS; SHA-256
  `9dc715b411da89c0fc8447bea0dcec731d0ae57b01e5a236658cd61b659358a1`,
  schema version `6`, and identical source/restore counts (`users=18`,
  `listings=6`, `price_observations=6`, `worker_jobs=0`, `migrations=6`)
- database process restart: PASS; the same source counts survived a fast
  stop/start and PostgreSQL-backed Playwright then passed `10/10`

Release-environment evidence still required: a current CI URL/artifact set,
Compose boot, encrypted off-host restore, and authorized HTTPS no-mock staging
smoke.

## Current verification status

The final working tree was verified on 2026-07-26 and recorded in release commit
`b3fb9a7`:

| Required command / evidence                     | Current result                                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `corepack pnpm format:check`                    | PASS                                                                                                                                                                                             |
| `corepack pnpm lint`                            | PASS — all five code workspaces                                                                                                                                                                  |
| `corepack pnpm typecheck`                       | PASS — all five code workspaces                                                                                                                                                                  |
| `corepack pnpm build`                           | PASS — shared, ML, providers, web, and API; web JavaScript `387.83 kB` / `112.15 kB` gzip                                                                                                        |
| `corepack pnpm test`                            | PASS — `445/445`: shared `3`, ML `19`, providers `73`, web `72`, API `278`, including all six real-PostgreSQL reliability tests                                                                  |
| `corepack pnpm test:integration`                | PASS — `45/45` with the real-PostgreSQL gate enabled                                                                                                                                             |
| `corepack pnpm test:e2e`                        | PASS — `20/20` in PostgreSQL mode across desktop, Pixel-sized mobile, and tablet projects, including axe WCAG A/AA scans                                                                         |
| `corepack pnpm test:sites`                      | PASS — `4/4`, including SPA restoration, same-origin API embedding, fail-closed missing origin, and configured proxy forwarding                                                                  |
| `corepack pnpm infrastructure:check`            | PASS — all 13 static infrastructure contracts                                                                                                                                                    |
| PostgreSQL migration                            | PASS — clean application of `001`–`007`; immediate second run applied nothing and remained at version `7`                                                                                        |
| PostgreSQL backup, restore, and service restart | PASS — custom-format isolated restore and post-restart ledgers both reported `7` migrations / max version `7`; backup SHA-256 `d17c49776aaeffd552815ae52f02dfd056dec301bc0b7c4817f391a936677c3d` |
| Final notification/security review              | PASS — no remaining P0, P1, or P2 finding; final focused closure set `31/31`                                                                                                                     |
| Manual responsive review                        | PASS — home/search/detail/error surfaces reviewed at 1440px desktop and 412px mobile; title wrapping, touch navigation, dense listing grid, and filter drawer repaired                           |

The responsive visual pass also caught and fixed low-contrast navigation
indexes, undersized listing links, bottom-navigation contrast, and a long
detail-title word break before the final browser run.

The current working tree still does not provide live external evidence:

- no explicitly gated authorized marketplace smoke ran;
- Resend/Twilio are implemented and fixture/contract tested but have no
  configured staging accounts, senders, verified destinations, callbacks, or
  delivery evidence;
- Docker is unavailable on this workstation, so no local Compose boot or image
  scan ran;
- `corepack pnpm deps:check` was blocked because this managed environment does
  not permit sending dependency metadata to the registry; approved CI must run
  it;
- the Sites edge deliberately returns `503` until an approved
  `CLOSETSEARCH_API_ORIGIN` is configured;
- no five-consecutive-suite run was recorded on the final tree.

Owner-only Sites version 2 was saved and deployed from exact commit
`b3fb9a7b68373fe5cbd9fbbfff47537dade19d1c`. The hosted frontend and SPA route
were verified; `/api/health/live` returned the designed `503` response stating
that the API origin is unconfigured and mock inventory is disabled. This is
deployment evidence for the frontend/fail-closed edge, not a live-data staging
smoke.

The code-level release candidate is clean, but the product remains **NO-GO for
a public live-data launch** until the external configuration and staging
evidence below exist.

## Remaining external blockers

1. Provider-specific authorization references for eBay, Grailed, Depop, Yahoo!
   Auctions Japan, and Mercari Japan, plus eBay production credentials and any
   required attribution.
2. Approved Resend/Twilio accounts, verified sender identities, credentials,
   signed-webhook secrets, HTTPS callback/action origins, explicit verified-user
   consent, and staging delivery evidence for any claimed outbound channel.
3. Production operations bearer token and secret-managed database/auth/provider
   configuration.
4. Production Sites-to-API origin wiring.
5. Billing provider and signed webhook configuration.
6. Approved live exchange-rate source.
7. Adequate privacy-reviewed temporal engagement and confirmed-sold datasets for
   ML promotion.
8. HTTPS no-mock staging environment and retained live-provider smoke evidence.

## Remaining internal/deployment work

- finish decomposing the oversized API dispatcher and web application
  composition modules
- replace process-local rate limiting/provider cache before unrestricted
  horizontal scale
- implement and test an approved external error-tracking exporter plus
  dashboards/alerts
- approve and enforce retention/deletion schedules; test Compose, encrypted
  off-host restore, managed HA/PITR/failover, and capacity plans in the intended
  deployment environment

## Deployment

1. Complete the [deployment checklist](runbooks/deployment-checklist.md).
2. Capture a fresh encrypted backup and isolated restore evidence.
3. Build immutable API/worker/web images.
4. Run the migration job once and verify versions `001`–`007`.
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
