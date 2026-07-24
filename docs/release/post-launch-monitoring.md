# Post-Deploy Monitoring

## Immediate

- verify web health, API liveness/readiness, `/operations/status`, metrics, and
  provider health
- verify schema version/checksums and database pool state
- confirm intended real provider IDs and zero active mock providers/listings
- inspect `worker_jobs_seeded`, leases, checkpoints, last success/failure
- run critical auth/feed/search/saved/alert/analytics smoke

## Observe

- request/feed/search latency and 4xx/5xx
- provider latency/success/rate limit/circuit/freshness
- database pool waiting/errors, query failure, transaction rollback/retry
- worker status counts, lease loss/dead jobs/checkpoint age/ingestion lag,
  never-succeeded state, and consecutive failures
- listing stale/sold/removed transition rates and duplicate ingestion
- engagement accepted/duplicate/rejected and rollup freshness
- watchlist match/unseen inbox and delivery retry/dead-letter state
- entitlement denials/expiry
- recommendation mode/version/latency/fallback reason/rate/concentration
- account token/rate-limit/session-expiry anomalies

## First normal scheduling interval

- active/sold jobs advance only for supported authorized providers
- checkpoint resumes and no duplicate price transition appears
- new/changed listing produces at most one watchlist match
- daily feature jobs remain scheduled
- no secrets, emails, tokens, database URLs, or raw ML features appear in logs

## Roll back or contain

Follow rollback for readiness, auth/data integrity, schema compatibility,
database saturation, unsafe provider behavior, uncontrolled worker lag/duplicate,
or secret exposure. Disable a single provider for its incident and show explicit
degradation; never activate mock fallback.
