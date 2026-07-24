# PostgreSQL Backup and Restore

## Policy

Recommended initial targets:

- backup cadence: daily at 02:00 UTC and before every risky migration
- operational recovery-point objective: 24 hours until managed point-in-time recovery is enabled
- restore-drill cadence: monthly and before public launch
- local retention: 14 daily backups
- durable retention: provider-managed encrypted storage according to the privacy/data-retention policy

For a real production service, enable managed PostgreSQL point-in-time recovery in addition to logical backups. Store logical backups outside the database host and outside the application deployment account.

## Backup

The script uses PostgreSQL custom format, verifies that `pg_restore` can read the archive, writes a SHA-256 checksum, and applies bounded retention:

```sh
DATABASE_URL='postgresql://...' \
BACKUP_DIR=/srv/closetsearch-backups \
BACKUP_RETENTION_DAYS=14 \
BACKUP_REQUIRE_ENCRYPTION=true \
BACKUP_AGE_RECIPIENT='age1...' \
sh scripts/postgres-backup.sh
```

Production encryption is fail-closed. The runtime needs `pg_dump`, `pg_restore`,
either `sha256sum` or `shasum`, and `age`. Database URLs and age identities
belong in secret management and must not be logged.

The Compose operations profile is a local one-shot demonstration:

```sh
docker compose --env-file .env.compose --profile operations run --rm backup
```

The stock PostgreSQL image does not include `age`, so the example uses `BACKUP_REQUIRE_ENCRYPTION=false`. Do not use that image/configuration for production backup storage.

Schedule the same immutable backup image through the deployment platform’s CronJob/scheduler. Alert when no successful backup exists inside the expected cadence.

## Restore drill

Always restore into an isolated, empty scratch database first. Never point a routine drill at the active production database.

1. Select one explicit backup file and its `.sha256` file.
2. Create a scratch database with a unique name.
3. Restrict application access to the scratch database.
4. Run:

```sh
RESTORE_DATABASE_URL='postgresql://.../closetsearch_restore_YYYYMMDD' \
RESTORE_TARGET_DATABASE='closetsearch_restore_YYYYMMDD' \
RESTORE_CONFIRMATION='restore:closetsearch_restore_YYYYMMDD' \
RESTORE_AGE_IDENTITY=/run/secrets/backup-age-identity.txt \
sh scripts/postgres-restore.sh /explicit/path/closetsearch-YYYYMMDDTHHMMSSZ.dump.age
```

5. Verify:

```sql
SELECT version, name, checksum, applied_at
FROM postgres_schema_migrations
ORDER BY version;

SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM listings;
SELECT COUNT(*) FROM price_observations;
SELECT COUNT(*) FROM worker_jobs;
```

6. Start an isolated API/worker against the restored database and run non-mutating smoke checks.
7. Record archive id, checksum, start/end time, schema version, row-count checks, operator, and outcome.
8. Destroy the scratch database only after evidence is retained.

The restore script requires an exact database-name confirmation, verifies that
`RESTORE_DATABASE_URL` reports that same name through `current_database()`,
requires a checksum and readable custom archive, and restores in one
transaction. It refuses PostgreSQL system databases.

## Production recovery

Prefer roll-forward for schema/application defects. Restore is appropriate only when confirmed data loss/corruption cannot be repaired safely.

Before production restore:

- declare an incident and freeze writes
- capture a final forensic backup if the database remains readable
- determine the accepted recovery point
- validate the selected archive in a scratch database
- obtain the required incident/change approval
- restore to a replacement database when possible, then switch connection secrets
- verify schema, critical row counts, auth/session policy, worker leases, and provider checkpoints
- rotate credentials if compromise is suspected

See [Production rollback](PRODUCTION_ROLLBACK.md).

## Evidence status

CI is configured to migrate PostgreSQL, create a custom-format archive, restore
it into an isolated database, and verify the migration ledger. Retain the
successful current-run URL, archive checksum, schema versions `001` through
`006`, row counts, and elapsed restore time as release evidence.

On 2026-07-24 an ephemeral local PostgreSQL 17.10 instance was migrated through
`006`; the backup script produced and checksummed a custom archive; and the
restore script restored it to an isolated database whose migration ledger count
and maximum version were both verified as `6`. That proves the local logical
path, not encryption, off-host retention, managed PITR/HA, a destructive
incident cutover, or the documented production RPO/RTO.
