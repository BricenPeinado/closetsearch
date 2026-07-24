# Known Limitations

## Launch blockers

- No real provider is authorized/configured in this checkout.
- eBay needs production Buy API credentials, partner eligibility/agreements, and
  any required affiliate attribution.
- Grailed needs exact written permission and a retained authorization reference.
- Therefore the requested two independently live real providers and no-mock
  staging smoke are not satisfied.
- This workstation has no Docker executable, so it cannot supply local Compose
  boot evidence. An ephemeral PostgreSQL 17.10 engine and isolated logical
  restore were verified locally, but that does not establish managed HA/PITR or
  encrypted off-host backup operations.
- Final code commit `3072b33` passed every locally executable required command
  and five consecutive full suites with the real-PostgreSQL gate. The production
  smoke remains blocked because no authorized HTTPS deployment URL exists.

## Providers and listings

- Provider fields can be incomplete, stale, removed, or unavailable.
- eBay Browse does not provide general confirmed-sold history.
- Grailed active/sold behavior is adapter/fixture evidence only while blocked.
- Process-local provider cache is not shared across API replicas.
- Cross-provider canonical dedupe is deliberately conservative and can leave
  uncertain duplicates.
- The central exchange service has cache/staleness/exact conversion behavior,
  but its default live rate provider is disabled; original currency remains.

## Accounts, billing, and alerts

- Account verification/reset/export API and web flows cannot deliver links until
  a transactional email provider/sender domain is configured.
- The breached-password integration boundary has no approved provider.
- API fixed-window rate limits are process-local.
- Premium uses persisted entitlements, but no billing/subscription provider or
  signed webhook route is configured.
- In-app watchlist alerts are implemented; email, push, and SMS are disabled.
- Alert delivery retry/dead-letter repositories exist, but no outbound delivery
  worker/provider is active.

## Analytics and ML

- Confirmed sold coverage depends on provider authorization/capability and may be
  absent; analytics explicitly fall back to asking observations.
- Observed ranges are not predictions, guarantees, financial advice, or future
  value.
- The recommendation fixture has only eight synthetic users/one snapshot and
  fails its diversity promotion gate.
- The fair-value fixture has only six test sales, worse MAE than baseline, and
  interval coverage `0.1667`.
- Rules ranking and observed ranges remain active fallbacks.
- No synthetic metric is production performance evidence.

## Trust

- Metadata-risk heuristics still exist as an optional experiment but are hidden
  unless `VITE_EXPERIMENTAL_METADATA_SIGNALS=true`.
- They are not authenticity analysis and never justify fake/authentic verdicts,
  blocking, filtering, or rank changes.

## Operations

- SQLite remains for local/test compatibility only.
- The API dispatcher and web application composition remain large despite
  incremental domain route/component extraction; further refactoring is needed
  before either becomes an easy multi-owner module.
- The API emits redacted structured logs and Prometheus metrics, but no external
  error-tracking exporter/provider is implemented.
- Local PostgreSQL evidence covers migrations `001`–`006`, real repository
  concurrency/rollback/lease/session cases, PostgreSQL-backed Playwright, and a
  checksummed isolated logical restore. A database-process stop/start preserved
  the verified data and the browser suite passed afterward. Retain
  CI/deployment evidence and still test managed HA/PITR/failover, encrypted
  off-host storage, and the container topology before launch.
- Managed high availability, point-in-time recovery, dashboards, alerts, secret
  rotation, and error-tracking provider configuration belong to the deployment
  environment and cannot be proven by repository artifacts alone.
- Provider/API rate and database pool budgets must be set across all replicas.
