# Deployment Checklist

See [Production deployment](PRODUCTION_DEPLOYMENT.md) for commands and current blockers.

## Build evidence

- [ ] frozen install succeeds
- [ ] infrastructure static validation succeeds
- [ ] formatting, lint, and typecheck pass
- [ ] workspace build and unit/contract tests pass
- [ ] PostgreSQL clean migration and integration tests pass
- [ ] backup/restore drill passes
- [ ] container topology builds and healthchecks pass
- [ ] browser/end-to-end gates pass
- [ ] dependency audit and image scan pass
- [ ] immutable image digests are recorded

The root package exposes `format:check`, `test:integration`, and `test:e2e`.
The Playwright gate covers signed-out, signed-in/onboarding, degraded-provider,
and revoked-session recovery flows using in-memory SQLite and explicitly
mock-only provider fixtures. It makes no live marketplace requests. A separate
staging smoke must still use `smoke:production` with authorized real providers.

## Persistence

- [ ] PostgreSQL is managed, encrypted, monitored, and backed up
- [ ] migration job runs once before application rollout
- [ ] schema checksum/version is verified
- [ ] API repositories and readiness use PostgreSQL, not the SQLite compatibility path
- [ ] worker lease/checkpoint state survives restarts
- [ ] recent restore evidence meets RPO/RTO

The PostgreSQL data plane and worker use are landed. The API request-repository
and readiness cutover item remains open and blocks public production readiness.

## Providers

- [ ] `PROVIDER_RUNTIME_MODE=real`
- [ ] `PROVIDER_ALLOW_MOCK_FALLBACK=false`
- [ ] `PROVIDER_MOCK_ENABLED=false`
- [ ] every enabled provider has current credentials/authorization
- [ ] provider attribution and compliance records are current
- [ ] readiness confirms a real provider
- [ ] production smoke confirms no mock/fixture inventory

## Security

- [ ] production HTTPS origins only
- [ ] secure cookies
- [ ] session pepper of at least 32 characters from secret management
- [ ] database TLS verifies the server certificate where supported
- [ ] logs/metrics contain no secrets or sensitive feature vectors
- [ ] API/worker containers run unprivileged with `no-new-privileges`
- [ ] credential rotation and incident contacts are tested

## Worker

- [ ] provider ingestion sources are registered in the worker entry point
- [ ] scheduled jobs are seeded idempotently
- [ ] ingestion last-success/lag and job failures are monitored
- [ ] alert retries/dead letters are monitored
- [ ] graceful shutdown is observed without duplicate work

Provider-ingestion registration and idempotent schedule seeding are implemented.
At deployment time, verify that `worker_jobs_seeded.activeProviderIds` contains
the intended authorized providers and that `blockedProviders` contains no
unexpected entry. An empty provider schedule without credentials is an explicit
external/configuration blocker, not successful live ingestion.

## Rollout

- [ ] fresh backup captured
- [ ] previous image digests retained
- [ ] canary API passes health and no-mock smoke
- [ ] worker starts with bounded concurrency
- [ ] web artifact targets the correct HTTPS API origin
- [ ] error, provider, database, worker, and feed metrics are observed
- [ ] rollback owner and decision deadline are set
