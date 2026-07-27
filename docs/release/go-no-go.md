# Production Go/No-Go

## Go criteria

- every required root command passes on the final SHA
- five consecutive full test runs pass
- PostgreSQL `001`–`007` migration/checksum/readiness pass on a real engine
- encrypted backup and isolated restore evidence meets RPO/RTO
- current containers boot and all healthchecks pass
- all five claimed marketplaces have retained provider-specific authorization
  references and pass readiness; eBay additionally has approved production
  credentials/agreements and any required attribution
- production smoke proves no mock provider/listing/fallback
- auth, verification/reset/export/deletion, saved state, entitlements,
  watchlist/inbox, analytics, and session expiry pass staging E2E
- worker leases/checkpoints/ingestion continue through restart
- provider, database, worker, engagement, alert, and ML metrics/alerts work
- operations probes authenticate with the secret-managed bearer token
- Sites is wired to the intended HTTPS API through
  `CLOSETSEARCH_API_ORIGIN`
- every enabled outbound channel has an approved provider/sender, verified
  destination and explicit current consent, signed webhook evidence,
  unsubscribe/STOP behavior, and suppression/retry monitoring
- provider compliance, privacy/retention, incident, deployment, and rollback
  records are approved

## Automatic no-go

- required retained provider authorization reference or credentials absent
- an enabled provider lacks its exact authorization reference
- production mock inventory or fallback possible
- migration drift/pending version/failure
- no successful restore drill
- auth/account or user-data loss/corruption
- cross-user authorization/CSRF/token leakage
- feed/search unusable without truthful degraded state
- worker duplicates/stalls or ingestion lag grows uncontrolled
- analytics/ML/authenticity copy overclaims
- unpromoted model used actively
- email/SMS described as active without configured Resend/Twilio, verified
  sender/destination, explicit consent, signed callbacks, and delivery evidence
- push or billing described as active without a real integration
- listing detail or price intelligence deployed before migration `007`
- operations endpoints exposed without the production bearer token
- Sites edge has no valid API origin while the product is described as live
- rollback owner, prior image, or safe schema strategy absent

Current state is **NO-GO for a public live-data launch**. All five adapters are
implemented, but durable authorization references/eBay credentials and live
smoke evidence are absent; outbound providers are unconfigured; migration `007`
has current local real-engine evidence but no production/CI rollout artifact;
Docker/Compose proof is unavailable locally; the dependency audit is blocked by
the managed environment's outbound-metadata policy; and Sites API-origin wiring
is not proven.
