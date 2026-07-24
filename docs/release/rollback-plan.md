# Release Rollback Plan

The authoritative operational procedure is [Production rollback](../runbooks/PRODUCTION_ROLLBACK.md). Database recovery is documented separately in [PostgreSQL backup and restore](../runbooks/POSTGRES_BACKUP_RESTORE.md).

## Release evidence

Before promotion, retain:

- previous and candidate API/web/worker image digests
- commit sha and CI run
- PostgreSQL schema version and migration checksums
- fresh backup/checksum and restore-drill evidence
- provider health/configuration without secrets
- production smoke result proving mock inventory is disabled

## Rollback triggers

- migration failure or checksum drift
- health/readiness failure
- widespread auth/session or saved-data regression
- unsafe provider behavior or mock inventory in production
- database corruption, pool exhaustion, or elevated transaction failures
- worker lease churn, dead jobs, duplicate processing, or growing ingestion lag

## Rules

- Roll back immutable application images before considering database restore.
- Keep forward-compatible schema changes and fix forward.
- Do not run ad hoc down migrations.
- Never activate mock inventory as a production fallback.
- Disable a failing real provider and expose degraded/unavailable state.
- Restore data only after explicit incident approval and a successful isolated validation.

After rollback, rerun liveness, readiness, auth, provider-health, no-mock feed, database, and worker-progress checks through the normal observation window.
