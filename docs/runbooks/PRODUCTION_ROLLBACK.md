# Production Rollback

## Principles

- Application rollback and database recovery are separate decisions.
- Prefer rolling application images back while leaving a forward-compatible schema in place.
- Do not run ad hoc down migrations in production.
- Never activate mock inventory as a production rollback.
- Restore a database only for confirmed corruption/data loss after a successful isolated restore validation.

## Before rollout

Record:

- previous and candidate API/web/worker image digests
- current PostgreSQL schema version and migration checksums
- backup archive/checksum and restore-drill evidence
- provider configuration and authorization references
- feature flags/model versions
- rollback owner and decision deadline

## Application rollback

1. Pause rollout and new worker scheduling.
2. Preserve logs, request ids, metrics, provider health, and job state.
3. Repoint API, worker, and web deployment manifests to the previous immutable digests.
4. Keep the current database schema if it is backward-compatible.
5. Wait for graceful termination; do not kill workers while leases are being checkpointed unless safety requires it.
6. Verify liveness, readiness, auth/session behavior, saved data, provider health, and no-mock production smoke.
7. Resume workers only after API/database compatibility is confirmed.

If a provider caused the incident, disable that provider and return an explicit degraded/unavailable state. Do not substitute fixtures.

## Migration failure

If the one-shot migration job fails before committing, keep the old application active, capture the migration error, and fix forward.

If a migration committed:

- verify whether the previous application remains compatible
- prefer a forward corrective migration
- if rollback is impossible without data loss, keep traffic paused and follow the database recovery decision process

## Database recovery

Follow [PostgreSQL backup and restore](POSTGRES_BACKUP_RESTORE.md). Restore to a replacement database where possible. Require incident approval, exact recovery point, scratch validation, and post-restore verification before changing `DATABASE_URL`.

## Success criteria

- health checks stable for the observation window
- mock/fixture providers inactive
- auth and saved-data checks pass
- database error/pool/retry metrics return to baseline
- worker leases and scheduled jobs progress without duplicates
- ingestion lag stops growing
- stakeholders receive a factual incident update
