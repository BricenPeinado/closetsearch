# Production Deployment

## Release boundary

The production topology and PostgreSQL request-path cutover are implemented.
A truthful live launch is still blocked until an authorized real provider is
configured. The repository has no eBay production credentials/approval and no
Grailed written-authorization reference. Never resolve that blocker by enabling
mock inventory.

## Artifacts

- `Dockerfile.api`
- `Dockerfile.web`
- `Dockerfile.worker`
- `docker-compose.yml`
- `.env.compose.example`
- `deploy/nginx.conf`
- `.github/workflows/ci.yml`
- `scripts/production-smoke-test.mjs`
- `scripts/postgres-backup.sh`
- `scripts/postgres-restore.sh`
- `scripts/build-sites.mjs`
- `sites/worker.mjs`

API, worker, web, and the one-shot migration job must use reviewed immutable
images from the same compatible release.

## Local production-like topology

```sh
cp .env.compose.example .env.compose
docker compose --env-file .env.compose config --quiet
docker compose --env-file .env.compose build
docker compose --env-file .env.compose up -d postgres migrate api worker web
docker compose --env-file .env.compose ps
```

Endpoints:

- web: `http://127.0.0.1:8080`
- API liveness: `http://127.0.0.1:4000/health/live`
- API readiness: `http://127.0.0.1:4000/health/ready`
- API metrics: `http://127.0.0.1:4000/metrics`
- durable operations state: `http://127.0.0.1:4000/operations/status`
- provider state: `http://127.0.0.1:4000/providers/health`

The example disables mock inventory. Feed/search may be unavailable without
provider authorization; that is the expected honest state.

## Sites web deployment

Sites can host the React web artifact, but it does not replace the separate
Node API, PostgreSQL database, or ingestion worker. The Sites build embeds
`/api` as the web API base and its worker proxies that path to the runtime
`CLOSETSEARCH_API_ORIGIN`.

```sh
corepack pnpm build:sites
corepack pnpm test:sites
```

Set `CLOSETSEARCH_API_ORIGIN` in Sites to the reviewed HTTPS API origin, then
save and deploy a new Sites version so the environment revision is applied.
Until it is configured, the edge proxy returns an explicit `503` and states
that mock inventory is disabled. Do not set it to a fixture, local, or
unreviewed API.

The deployable layout is `dist/server/index.js` plus `dist/client`. It includes
SPA route restoration, security headers, immutable caching for hashed assets,
an edge liveness endpoint at `/health/live`, and no-store API proxy responses.

Stop without deleting volumes:

```sh
docker compose --env-file .env.compose down
```

Use `--volumes` only for an explicitly approved destructive local reset.

## Required production configuration

- `NODE_ENV=production`
- `PERSISTENCE_DRIVER=postgres`
- `DATABASE_URL` from secret management
- `POSTGRES_SSL_MODE=verify-full` plus trusted CA where supported
- `AUTH_ALLOWED_ORIGINS` containing explicit HTTPS origins only
- `AUTH_COOKIE_SECURE=true`
- `AUTH_SESSION_PEPPER` of at least 32 secret characters
- `PROVIDER_RUNTIME_MODE=real`
- `PROVIDER_ALLOW_MOCK_FALLBACK=false`
- `PROVIDER_MOCK_ENABLED=false`
- at least one configured/authorized real provider
- a build-time HTTPS `VITE_API_BASE_URL`

If recommendation shadowing is enabled, also supply an immutable reviewed
artifact path. Active mode additionally requires an artifact whose lifecycle is
`promoted` and `CLOSETSEARCH_RECOMMENDATION_PROMOTION_APPROVED=true`. The
checked-in synthetic candidate is not promotable.

## Pre-deploy evidence

1. Provider authorization/compliance record is current.
2. Required root quality commands pass on the candidate.
3. Five consecutive clean full test runs are recorded.
4. Clean PostgreSQL migration reaches version `006` without drift.
5. Dependency/image scans meet policy.
6. Fresh encrypted backup and recent isolated restore drill meet RPO/RTO.
7. Previous image digests and rollback owner are recorded.
8. No-mock staging smoke succeeds against the intended real provider IDs.

## Deployment sequence

1. Freeze release scope and capture current image/schema/provider/model state.
2. Build and scan immutable API/worker/web images.
3. Run the migration image once.
4. Verify:

   ```sql
   SELECT version, name, checksum
   FROM postgres_schema_migrations
   ORDER BY version;
   ```

5. Deploy one worker replica. Inspect `worker_jobs_seeded`,
   `activeProviderIds`, `blockedProviders`, and checkpoint/job health.
6. Deploy one API canary. Verify liveness, PostgreSQL/migration readiness,
   provider readiness, auth, account, saved-state, alerts, analytics, and
   metrics.
7. Expand API and worker replicas within the total database/provider concurrency
   budget.
8. Deploy the web artifact built for the correct API origin.
9. Run:

   ```sh
   CLOSETSEARCH_API_BASE_URL=https://api.example.com \
   CLOSETSEARCH_EXPECTED_PROVIDER_IDS=ebay \
   corepack pnpm smoke:production
   ```

10. Observe through at least one ingestion interval and the agreed rollout
    window.

## Health semantics

- `/health/live`: process/event-loop response only
- `/health/ready`: PostgreSQL access, migration state, and at least one active
  real provider in production
- `/operations/status`: sanitized durable job/checkpoint/provider state; no job
  payloads, continuation cursors, provider metadata, credentials, or raw error
  messages
- `/providers/health`: capability/config/authorization-safe provider state; no
  secret values
- worker process healthcheck: process liveness only
- durable `worker_jobs`, provider checkpoint/health, last success/failure, and
  ingestion lag: authoritative worker progress

## Metrics and alerts

Observe:

- HTTP request count and duration histogram by normalized route/status/method
- provider success/failure/duration, rate-limit, cache, and circuit state
- database pool total/idle/waiting/error, query failures, transaction rollback/
  retry
- worker job state, failure/lease-loss/dead jobs, checkpoint age, ingestion lag,
  never-succeeded checkpoints, and consecutive failures
- engagement accept/duplicate/reject and rollup freshness
- alert match/delivery/dead-letter state
- recommendation request, runtime latency, fallback reason/rate, and model
  version
- no active mock provider/listing

The API currently emits sanitized structured error logs to stderr; it does not
implement an external error-tracking exporter. Choose and test an approved
collector/provider before launch. Any collector must preserve redaction: no
secrets, raw action/session tokens, raw passwords, direct identifiers, provider
payloads, or sensitive ML features.

## Stop/rollback conditions

- migration checksum drift or pending schema
- any active mock provider/listing
- no authorized real provider
- readiness or auth/session regression
- elevated 5xx/database saturation
- provider circuit/rate-limit escalation
- worker lease churn, dead jobs, or growing ingestion lag
- alert noise/dead-letter growth
- ML fallback/latency/concentration outside approved thresholds

Follow [Production rollback](PRODUCTION_ROLLBACK.md) and
[Incident response](INCIDENT_RESPONSE.md).

## Evidence limitation

CI defines real PostgreSQL migration/backup/restore and container jobs. Local
PostgreSQL 17.10 evidence covers migrations, reliability cases,
PostgreSQL-backed browser tests, and a checksummed isolated logical restore.
This workstation has no Docker executable, so there is no local Compose boot;
the local restore also does not prove encryption, off-host retention, managed
HA/PITR, or incident cutover. Record the actual CI/deployment run URL and
artifacts before making a production claim.
