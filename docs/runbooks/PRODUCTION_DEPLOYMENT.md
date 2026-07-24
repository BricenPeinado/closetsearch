# Production Deployment

## Current release boundary

The repository now has reproducible API, web, worker, migration, PostgreSQL, and
backup container definitions. The PostgreSQL data plane includes migration
checksums, listing lifecycle and price history, provider checkpoints, durable
jobs/leases, engagement, entitlements, and alert repositories.

The worker now builds ingestion sources only from active, authorized real
providers, registers the `provider.ingest` handler, seeds resumable active/sold
search jobs idempotently, and excludes mock inventory. When authorization or
credentials are absent, it emits `blockedProviders` and seeds no provider job
instead of substituting fixtures.

One critical persistence cutover remains visible: API request handlers for
user/session/saved features and `/health/ready` still use the SQLite
compatibility repositories. The production startup validator requires
PostgreSQL configuration, but the main API server has not yet migrated every
request repository or its lifecycle/readiness hooks to PostgreSQL.

Until that request-path cutover is resolved and exercised end to end, use this
topology for integration/staging work, not a public production claim.

## Artifacts

- `Dockerfile.api`
- `Dockerfile.web`
- `Dockerfile.worker`
- `docker-compose.yml`
- `.env.compose.example`
- `deploy/nginx.conf`
- `.github/workflows/ci.yml`

Images run API and worker processes separately. PostgreSQL migrations run as a one-shot service before either long-lived process.

## Local topology

Prepare an ignored environment file:

```sh
cp .env.compose.example .env.compose
```

The example disables mock inventory. Without authorized provider credentials, feed/search may be unavailable; this is intentional and must not be “fixed” by silently activating fixtures.

Validate and start:

```sh
docker compose --env-file .env.compose config --quiet
docker compose --env-file .env.compose build
docker compose --env-file .env.compose up -d postgres migrate api worker web
docker compose --env-file .env.compose ps
```

Local endpoints:

- web: `http://127.0.0.1:8080`
- API liveness: `http://127.0.0.1:4000/health/live`
- API readiness: `http://127.0.0.1:4000/health/ready`
- API metrics: `http://127.0.0.1:4000/metrics`

Stop the topology:

```sh
docker compose --env-file .env.compose down
```

Do not add `--volumes` unless deletion of local PostgreSQL, backup, and compatibility data is explicitly intended.

## Production configuration

Production must set:

- `NODE_ENV=production`
- `PERSISTENCE_DRIVER=postgres`
- `AUTH_ALLOWED_ORIGINS` to explicit HTTPS web origins only
- `AUTH_COOKIE_SECURE=true`
- `AUTH_SESSION_PEPPER` to a secret of at least 32 characters
- `PROVIDER_RUNTIME_MODE=real`
- `PROVIDER_ALLOW_MOCK_FALLBACK=false`
- `PROVIDER_MOCK_ENABLED=false`
- at least one fully configured, authorized real provider
- `DATABASE_URL` from secret management
- `POSTGRES_SSL_MODE=verify-full` and a trusted `POSTGRES_SSL_CA` where the database supports it

`POSTGRES_SSL_MODE=disable` plus `POSTGRES_ALLOW_INSECURE=true` exists only for the isolated local Compose network and CI.

Build the web image with the public API origin:

```sh
docker build \
  --file Dockerfile.web \
  --build-arg VITE_API_BASE_URL=https://api.example.com \
  --tag registry.example/closetsearch-web:<immutable-version> \
  .
```

Build API and worker images from the same reviewed commit and tag them immutably. Prefer registry digests in the deployment manifest.

## Deployment order

1. Confirm a fresh backup and a recent restore drill.
2. Run frozen dependency install and all CI gates.
3. Build and scan images from the reviewed commit.
4. Run PostgreSQL migrations as a one-shot job using the new API image.
5. Verify migration checksums and schema version.
6. Deploy worker with zero or one replica first; inspect `worker_jobs_seeded`,
   its `activeProviderIds`/`blockedProviders`, and database health.
7. Deploy API as a canary, then verify liveness/readiness and provider health.
8. Deploy the web artifact built for the correct API origin.
9. Run `node scripts/production-smoke-test.mjs` with HTTPS and expected real-provider ids.
10. Observe errors, provider latency/rate limits, database pool metrics, worker failures, and ingestion lag through the rollout window.

Never run migration independently in every API replica. The migration layer has advisory locking, but a dedicated one-shot job makes failure and audit state clearer.

## Health semantics

- `/health/live` proves the API event loop can answer.
- `/health/ready` currently proves the SQLite compatibility database is
  readable and, in `NODE_ENV=production`, at least one real provider is
  configured; it does not yet prove the PostgreSQL request path is ready.
- the worker container healthcheck proves process liveness only
- durable job last-success/failure state, provider checkpoints, and ingestion
  lag are the authoritative worker health signals

PostgreSQL API readiness is not complete until API repositories are switched to the PostgreSQL data plane.

## Rollout checks

Stop rollout on:

- migration failure or checksum drift
- any mock/fixture provider active in production
- readiness failures
- unexpected auth/session invalidation
- elevated 5xx rates or provider circuit opening
- database pool saturation or transaction retry spikes
- worker lease churn, dead jobs, or growing ingestion lag

Follow [Production rollback](PRODUCTION_ROLLBACK.md) and [Incident response](INCIDENT_RESPONSE.md).
