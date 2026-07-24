# Production Go/No-Go

## Go criteria

- every required root command passes on the final SHA
- five consecutive full test runs pass
- PostgreSQL `001`–`006` migration/checksum/readiness pass on a real engine
- encrypted backup and isolated restore evidence meets RPO/RTO
- current containers boot and all healthchecks pass
- at least one authorized real provider passes readiness; the release target
  requires two independently functioning real providers
- production smoke proves no mock provider/listing/fallback
- auth, verification/reset/export/deletion, saved state, entitlements,
  watchlist/inbox, analytics, and session expiry pass staging E2E
- worker leases/checkpoints/ingestion continue through restart
- provider, database, worker, engagement, alert, and ML metrics/alerts work
- provider compliance, privacy/retention, incident, deployment, and rollback
  records are approved

## Automatic no-go

- provider authorization/credentials absent
- production mock inventory or fallback possible
- migration drift/pending version/failure
- no successful restore drill
- auth/account or user-data loss/corruption
- cross-user authorization/CSRF/token leakage
- feed/search unusable without truthful degraded state
- worker duplicates/stalls or ingestion lag grows uncontrolled
- analytics/ML/authenticity copy overclaims
- unpromoted model used actively
- email/push/SMS/billing described as active without real integration
- rollback owner, prior image, or safe schema strategy absent

Current state is **NO-GO for a public live-data launch** because real provider
authorization is absent and final release evidence is incomplete.
