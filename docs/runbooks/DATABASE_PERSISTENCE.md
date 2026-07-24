# Database Persistence

## Supported drivers

- **PostgreSQL:** required in production; used by API request state and worker
  state.
- **SQLite:** synchronous local/test compatibility path only. It is used by
  hermetic tests and simple development when PostgreSQL is unnecessary.

`validateStartupEnvironment` rejects `PERSISTENCE_DRIVER=sqlite` in production.

## PostgreSQL runtime

The implementation in `apps/api/src/db/postgres` provides a bounded `pg` pool,
connection/idle/query/statement timeouts, transient transaction retry,
instrumented query/transaction/pool metrics, readiness, and graceful close.

Required:

```sh
PERSISTENCE_DRIVER=postgres
DATABASE_URL=postgresql://...
```

Run production migrations explicitly:

```sh
corepack pnpm db:migrate
```

`PERSISTENCE_MIGRATE_ON_START` defaults off in production. Use one dedicated
migration job before rolling API/worker images.

## Migration ledger and drift

PostgreSQL migrations are named `NNN_name.sql` and recorded in
`postgres_schema_migrations` with namespace, version, name, SHA-256 checksum,
application time, and execution duration.

The runner:

- takes an advisory lock
- rejects duplicate or out-of-order local versions
- rejects a renamed, missing, or checksum-changed applied migration
- applies each pending migration in its own transaction
- makes readiness fail while migrations are pending or drifted

Applied migration files are immutable. Correct mistakes with a new forward
migration.

Current PostgreSQL schema:

| Version                                  | Main tables                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_identity_and_access`                | `users`, `user_identities`, `account_tokens`, `auth_sessions`, `user_settings`                                                                       |
| `002_catalog_ingestion_and_jobs`         | brands/aliases, listings/images/current state/transitions, currency rates, price observations, ingestion checkpoints/health/events, worker jobs/runs |
| `003_engagement_alerts_and_entitlements` | likes, searches, filters, watchlists/preferences, raw/daily engagement, alert matches/deliveries, subscriptions, entitlements, webhook events        |
| `004_ml_and_operations`                  | datasets, feature snapshots, model versions/predictions, audit records, maintenance runs                                                             |
| `005_request_store_hardening`            | token invalidation, normalized email uniqueness, watchlist brand compatibility                                                                       |
| `006_user_engagement_features`           | per-user daily listing engagement aggregates                                                                                                         |

## Important invariants

- provider/source listing identity is unique
- ingestion event/idempotency keys deduplicate retry and concurrency
- an exact collection replay deduplicates, while a later unchanged collection
  updates `last_seen_at` without adding a price observation
- price and currency checks reject invalid values
- changed price observations receive a monotonic `observation_version`
- latest price/history queries order by the version, not timestamp alone
- session and account action tokens are stored only as hashes
- verified email identity and user-owned saved state have foreign-key ownership
- alert match/delivery and billing webhook identities are idempotent
- multi-table user/session/listing/alert operations use transactions

## API and worker ownership

The PostgreSQL request store backs production auth, onboarding, likes, recent
and saved searches, saved filters, watchlists, notification preferences,
settings, account-security flows, and in-app alerts.

PostgreSQL feed/search persist sanitized normalized provider results before
returning them. Likes and engagement therefore target an existing server-owned
catalog row; client listing content cannot create or rewrite catalog price,
market state, or analytics history.

The worker owns scheduled provider ingestion and maintenance:

- durable job lease/heartbeat/run records
- provider-native continuation checkpoints
- idempotent listing/state/price upserts
- stale-state transitions
- watchlist matching
- daily engagement rollups

The worker and API may share a database, but each deployment replica must have a
budgeted pool and distinct `POSTGRES_APPLICATION_NAME`.

## SQLite compatibility

SQLite migrations `001` through `007_account_security` remain under
`apps/api/src/db/schema`. They cover the earlier local user/session/saved/
analytics/watchlist/account-security implementation and include the same
deterministic price-observation ordering fix.

Run:

```sh
corepack pnpm db:migrate:sqlite
corepack pnpm db:seed:sqlite
```

These explicit commands target SQLite compatibility. Do not use them as the
production PostgreSQL migration or seed path.

## Verification

Repository tests cover clean/idempotent migration, drift, rollback, concurrent
upserts, duplicate ingestion, same-timestamp price transitions, restart
persistence, leases/checkpoints, request state, auth/account security, alerts,
and engagement.

The fast local PostgreSQL harness uses `pg-mem`. When
`POSTGRES_INTEGRATION_DATABASE_URL` is set, a real-engine suite verifies upgrade
from every prior migration, concurrent idempotent upserts, transaction rollback,
lease contention, and session revocation. CI starts PostgreSQL 17 for this
suite, PostgreSQL-backed Playwright, the real migration CLI, a custom-format
`pg_dump`, and isolated restore.

Before release, retain evidence for:

```sql
SELECT version, name, checksum, applied_at
FROM postgres_schema_migrations
ORDER BY version;
```

Also retain critical row counts, worker checkpoint state, backup checksum,
restore duration, and application smoke output.

An ephemeral PostgreSQL 17.10 local run applied migrations `001`–`006`, passed
the five real-engine reliability cases five consecutive times, and passed the
full API suite against the real engine. A checksummed logical archive was also
restored to an isolated database with migration count/max version `6`. Docker is
still unavailable, so this evidence does not include a Compose boot, database
service restart, managed HA/PITR, or encrypted off-host retention.

## Backup, recovery, and retention

See [PostgreSQL backup and restore](POSTGRES_BACKUP_RESTORE.md). Production
should use encrypted off-host logical backups plus managed point-in-time
recovery. Prefer application rollback and forward schema repair; database restore
is reserved for confirmed loss/corruption after isolated validation.

Retention policy must cover:

- expired/revoked sessions and account tokens
- raw engagement versus aggregate feature windows
- ingestion-event idempotency records
- worker runs and operational/audit records
- alert deliveries/dead letters
- provider data deletion/retention obligations

Do not delete listing or price history merely because a current listing becomes
sold, stale, removed, or unavailable.
