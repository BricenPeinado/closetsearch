# Deployment Checklist

See [Production deployment](PRODUCTION_DEPLOYMENT.md) and
[Production rollback](PRODUCTION_ROLLBACK.md).

## Authorization and data

- [ ] every enabled provider has current approval/credentials
- [ ] the provider acquisition record covers display, retention, history,
      analytics/ML, attribution, regions, and revocation
- [ ] eBay partner/affiliate obligations or Grailed written authorization are
      retained as applicable
- [ ] Depop, Yahoo! Auctions Japan, and Mercari Japan each have an exact
      provider-specific authorization reference covering the enabled method,
      identity, rate, fields, retention, attribution, analytics/ML, and
      revocation scope
- [ ] `PROVIDER_RUNTIME_MODE=real`
- [ ] `PROVIDER_ALLOW_MOCK_FALLBACK=false`
- [ ] `PROVIDER_MOCK_ENABLED=false`
- [ ] authorized staging smoke proves no mock listing/provider is active

## Build and quality

- [ ] frozen install
- [ ] format check, lint, typecheck, build
- [ ] unit/contract tests
- [ ] PostgreSQL integration tests
- [ ] Playwright signed-out, signed-in/onboarding/likes,
      watchlist-create-edit-delete, entitlement-gated analytics, degraded-provider,
      session-expiry, and PostgreSQL account-deletion flows
- [ ] axe-core WCAG A/AA scans pass; keyboard/screen-reader/zoom/mobile checks
      remain manually reviewed
- [ ] generated 1200×630 Open Graph/Twitter card resolves from deployed HTTPS
      metadata and target link-unfurler previews are retained
- [ ] five consecutive clean full test runs
- [ ] OpenAPI contract validation
- [ ] dependency and image vulnerability policy
- [ ] immutable image digests recorded

## PostgreSQL

- [ ] managed encrypted service and total pool budget approved
- [ ] migration job reaches version `007`
- [ ] migration names/checksums inspected
- [ ] API readiness reports PostgreSQL and no pending migrations
- [ ] concurrent writes, rollback, restart, lease contention, session
      revocation/expiry verified on a real engine
- [ ] listing detail/original-language fields, typed price observations/trends,
      notification consent/suppression/webhook state, and delivery attempts are
      exercised on migration `007`
- [ ] fresh encrypted backup exists off host
- [ ] isolated restore drill and row-count/schema evidence meet RPO/RTO

## Security

- [ ] explicit HTTPS allowed origins
- [ ] secure cookies and session pepper from secret management
- [ ] stable notification-destination pepper from secret management; rotation
      impact on consent/suppression records is understood
- [ ] database TLS certificate verification
- [ ] body/origin/CSRF/rate-limit controls exercised
- [ ] account verification/reset/export/deletion behavior exercised
- [ ] `OPERATIONS_BEARER_TOKEN` is secret-managed, at least 32 characters, and
      sent by health/metrics monitors without being logged
- [ ] logs/metrics contain no credentials, tokens, personal email, database URL,
      or sensitive feature vectors
- [ ] rotation and incident contacts tested

## Worker and alerts

- [ ] `worker_jobs_seeded.activeProviderIds` is exactly expected
- [ ] no unexpected `blockedProviders`
- [ ] jobs seed idempotently and leases/checkpoints survive restart
- [ ] active/sold scope matches provider capability
- [ ] ingestion last success/lag, stale maintenance, and provider health advance
- [ ] watchlist match, inbox unseen/seen/dismiss, frequency/quiet hours pass
- [ ] delivery retry/dead-letter state is monitored
- [ ] email/SMS remain disabled unless Resend/Twilio accounts, verified
      senders/numbers, credentials, signed-webhook configuration, HTTPS public origins,
      explicit verified-user consent, unsubscribe/STOP handling, and staging
      delivery/callback evidence are separately approved and tested
- [ ] push remains disabled

## ML

- [ ] intended mode and immutable artifact digest recorded
- [ ] active mode uses a promoted, non-stale artifact and explicit approval
- [ ] rules and observed-range fallback tested
- [ ] latency, fallback, coverage, diversity, provider/brand concentration, and
      model version observed
- [ ] no synthetic fixture is described as production performance evidence

## Rollout

- [ ] previous image digests retained
- [ ] rollback owner/deadline declared
- [ ] migration, worker, API canary, then web deployed in order
- [ ] liveness/readiness/provider health/no-mock smoke pass
- [ ] `/operations/status` and `/metrics` expose current sanitized durable state
      without payloads, cursors, credentials, raw errors, or unbounded route labels
- [ ] authenticated `/providers/health`, `/operations/status`, and `/metrics`
      probes reject missing/invalid bearer tokens
- [ ] Sites `CLOSETSEARCH_API_ORIGIN` identifies the intended HTTPS Node API;
      `/api` works end to end and does not return the fail-closed `503`
- [ ] critical user flows pass against the deployed environment
- [ ] metrics stable through one normal ingestion interval
- [ ] release evidence and remaining external blockers recorded

An empty real-provider schedule is an external/configuration blocker, not a
successful live deployment. This workstation lacks Docker, so a local Compose
check cannot be marked complete here. Its managed policy also prevents the local
dependency audit from sending dependency metadata outbound; retain that result
from approved CI instead.
