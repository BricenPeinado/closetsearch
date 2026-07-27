# Known Limitations

## Launch blockers

- All five requested marketplace adapters are implemented, but no real provider
  is activation-ready/configured in this checkout.
- eBay needs production Buy API credentials, partner eligibility/agreements, and
  any required affiliate attribution.
- The operator attested permission for Grailed, Depop, Yahoo! Auctions Japan,
  and Mercari Japan, but each still needs a retained non-secret
  provider-specific authorization reference for the implemented access method
  and data-use scope before production can enable it.
- Therefore no live five-marketplace or no-mock staging claim is satisfied.
- Resend/Twilio transports exist but production credentials, verified
  senders/numbers, webhook secrets, public callback origins, verified-user
  consent, and delivery evidence are absent.
- PostgreSQL migration `007` has not yet received retained final release
  evidence on the current tree. Listing detail, price trends, and outbound
  delivery require that migration and are unavailable in SQLite mode.
- The production operations bearer token and the Sites
  `CLOSETSEARCH_API_ORIGIN` are not configured in the repository. A Sites edge
  without a valid origin returns `503`.
- This workstation has no Docker executable, so it cannot supply local Compose
  boot evidence.
- The dependency audit is blocked in this managed environment because it would
  send dependency metadata outbound; approved CI must supply that evidence.
- Historical final-code evidence on `3072b33` predates the current
  five-provider, notification, price-intelligence, and migration `007` changes
  and cannot be carried forward as a current release pass.

## Providers and listings

- Provider fields can be incomplete, stale, removed, or unavailable.
- eBay Browse does not provide general confirmed-sold history.
- Grailed, Depop, Yahoo! Auctions Japan, and Mercari Japan behavior is
  adapter/fixture evidence only while live access is blocked.
- Japanese original-language fields and marketplace limitations are preserved
  only when a provider supplies them; translations may be absent.
- Auction current bids and completed-auction prices are distinct. A missing
  completed price is not inferred as a sale.
- Process-local provider cache is not shared across API replicas.
- Cross-provider canonical dedupe is deliberately conservative and can leave
  uncertain duplicates.
- The central exchange service has cache/staleness/exact conversion behavior,
  but its default live rate provider is disabled; original currency remains.

## Accounts, billing, and alerts

- Account verification/reset/export API and web flows cannot deliver links until
  the Resend transport, verified sender domain, public action origin, and
  credentials are configured.
- The breached-password integration boundary has no approved provider.
- API fixed-window rate limits are process-local.
- Premium uses persisted entitlements, but no billing/subscription provider or
  signed webhook route is configured.
- In-app watchlist alerts are implemented and default on.
- Email/SMS transports, worker processing, consent/suppression state, phone
  verification, unsubscribe/STOP handling, and signed webhook handlers are
  implemented, but both outbound channels default off and are inactive without
  configuration, explicit opt-in, a verified destination, per-watchlist
  enablement, and staging evidence.
- Push delivery is not implemented.
- Notification destinations are operational personal data. Production
  retention/deletion, subprocessor, and support-contact policy still needs
  approval.

## Listing detail and price intelligence

- Durable listing detail and price trends require PostgreSQL and migration
  `007`; local SQLite compatibility returns an honest unavailable response.
- Trend calculations use observations ClosetSearch has actually retained. A
  provider outage, sparse history, asking-only evidence, or short observation
  period lowers confidence or yields no trend.
- Currency series are never silently combined. Without approved FX provenance,
  cross-currency comparisons remain separate.
- Trend summaries are descriptive observations, not forecasts, valuation
  guarantees, or investment advice.

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
- Historical local PostgreSQL evidence covers migrations `001`–`006`, real repository
  concurrency/rollback/lease/session cases, PostgreSQL-backed Playwright, and a
  checksummed isolated logical restore. A database-process stop/start preserved
  the verified data and the browser suite passed afterward. It does not verify
  current migration `007`; retain current CI/deployment evidence and still test
  managed HA/PITR/failover, encrypted off-host storage, and the container
  topology before launch.
- `/metrics`, `/operations/status`, and `/providers/health` require a bearer
  token in production and whenever configured; monitors must send it without
  logging it.
- Managed high availability, point-in-time recovery, dashboards, alerts, secret
  rotation, and error-tracking provider configuration belong to the deployment
  environment and cannot be proven by repository artifacts alone.
- Provider/API rate and database pool budgets must be set across all replicas.
