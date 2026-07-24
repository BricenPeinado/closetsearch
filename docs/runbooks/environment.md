# Environment Reference

Environment examples are documentation only:

- root development: `.env.example`
- API/worker development: `apps/api/.env.example`
- web build: `apps/web/.env.example`
- local container topology: `.env.compose.example`

Never commit populated `.env` files. Production secrets must come from the deployment platform’s secret manager.

## Production invariants

`validateStartupEnvironment` rejects a production API start unless:

- `AUTH_SESSION_PEPPER` is at least 32 characters
- `AUTH_COOKIE_SECURE=true`
- every `AUTH_ALLOWED_ORIGINS` value is explicit HTTPS and not localhost
- `PROVIDER_RUNTIME_MODE=real`
- mock fallback and the mock provider are disabled
- `PERSISTENCE_DRIVER=postgres`

Production also requires at least one authorized/configured real provider for readiness.

`DATABASE_URL` is authoritative for PostgreSQL migrations, the worker, and the
landed durable data-plane repositories. The current API request repositories
and readiness database check still use `CLOSETSEARCH_DB_PATH` while those
modules migrate incrementally. This split is a launch blocker, not a supported
final production architecture.

## API process

| Variable               | Default                 | Production                                              |
| ---------------------- | ----------------------- | ------------------------------------------------------- |
| `NODE_ENV`             | runtime default         | `production`                                            |
| `HOST`                 | `127.0.0.1`             | bind the platform interface, commonly `0.0.0.0`         |
| `PORT`                 | `4000`                  | platform-assigned or `4000`                             |
| `SHUTDOWN_TIMEOUT_MS`  | `10000`                 | 1–60 seconds; align with termination grace              |
| `PERSISTENCE_DRIVER`   | explicit value required | `postgres`; `sqlite` is test/local only                 |
| `CLOSETSEARCH_DB_PATH` | local `.data` file      | compatibility only; PostgreSQL cutover remains required |

## PostgreSQL

| Variable                           | Default                                      | Notes                                                             |
| ---------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`                     | none                                         | required by migrations, worker, and PostgreSQL data-plane clients |
| `POSTGRES_APPLICATION_NAME`        | `closetsearch-api`                           | use distinct API/worker/migration names                           |
| `POSTGRES_SSL_MODE`                | `prefer`                                     | `disable`, `prefer`, `require`, or `verify-full`                  |
| `POSTGRES_SSL_CA`                  | none                                         | CA PEM for `verify-full`; escaped newlines are accepted           |
| `POSTGRES_ALLOW_INSECURE`          | false                                        | only explicit local/CI override for disabled TLS                  |
| `POSTGRES_POOL_MAX`                | `10`                                         | 1–100; budget across all replicas                                 |
| `POSTGRES_CONNECTION_TIMEOUT_MS`   | `5000`                                       | 100–120000                                                        |
| `POSTGRES_IDLE_TIMEOUT_MS`         | `30000`                                      | 1000–600000                                                       |
| `POSTGRES_STATEMENT_TIMEOUT_MS`    | `10000`                                      | 100–300000                                                        |
| `POSTGRES_QUERY_TIMEOUT_MS`        | `12000`                                      | 100–300000                                                        |
| `POSTGRES_TRANSACTION_RETRY_LIMIT` | `3`                                          | 0–10 transient retries                                            |
| `PERSISTENCE_MIGRATE_ON_START`     | true outside production, false in production | keep false in production and use the one-shot migration job       |

Compose uses disabled TLS only inside its isolated local network and sets `POSTGRES_ALLOW_INSECURE=true`. Managed production should use `verify-full` whenever supported.

## Auth and sessions

| Variable                   | Default                | Production                       |
| -------------------------- | ---------------------- | -------------------------------- |
| `AUTH_ALLOWED_ORIGINS`     | local Vite origins     | explicit HTTPS origins only      |
| `AUTH_SESSION_COOKIE_NAME` | `closetsearch_session` | keep stable                      |
| `AUTH_SESSION_TTL_DAYS`    | `14`                   | set according to security policy |
| `AUTH_COOKIE_SECURE`       | production-sensitive   | must be `true`                   |
| `AUTH_SESSION_PEPPER`      | empty                  | secret, at least 32 characters   |
| `AUTH_TOKEN_PEPPER`        | empty                  | legacy fallback only             |

Rotating the session pepper revokes existing sessions.

## Provider orchestration

| Variable                        | Development default                         | Production |
| ------------------------------- | ------------------------------------------- | ---------- |
| `PROVIDER_RUNTIME_MODE`         | `mock` unless a real provider is configured | `real`     |
| `PROVIDER_ALLOW_MOCK_FALLBACK`  | `true`                                      | `false`    |
| `PROVIDER_MOCK_ENABLED`         | `true`                                      | `false`    |
| `PROVIDER_REQUEST_TIMEOUT_MS`   | `10000`                                     | 1000–60000 |
| `PROVIDER_MAX_ACTIVE_PROVIDERS` | `2`                                         | 1–5        |

Mock inventory is fixtures only and may not be substituted silently in production.

### eBay official API

| Variable                       | Default                | Notes                                   |
| ------------------------------ | ---------------------- | --------------------------------------- |
| `EBAY_PROVIDER_ENABLED`        | `false`                | enable only with approved credentials   |
| `EBAY_CLIENT_ID`               | none                   | secret/config credential                |
| `EBAY_CLIENT_SECRET`           | none                   | secret                                  |
| `EBAY_API_BASE_URL`            | `https://api.ebay.com` | API origin                              |
| `EBAY_IDENTITY_BASE_URL`       | `https://api.ebay.com` | OAuth origin                            |
| `EBAY_MARKETPLACE_ID`          | `EBAY_US`              | marketplace header                      |
| `EBAY_OAUTH_SCOPE`             | public API scope       | approved OAuth scope                    |
| `EBAY_AFFILIATE_CAMPAIGN_ID`   | none                   | optional approved affiliate attribution |
| `EBAY_AFFILIATE_REFERENCE_ID`  | none                   | optional attribution                    |
| `EBAY_REQUEST_TIMEOUT_MS`      | `8000`                 | bounded request timeout                 |
| `EBAY_MIN_REQUEST_INTERVAL_MS` | `250`                  | pacing                                  |
| `EBAY_MAX_CONCURRENCY`         | `2`                    | 1–10                                    |
| `EBAY_MAX_RETRIES`             | `3`                    | bounded retry count                     |

### Grailed authorized scraping

| Variable                          | Default                   | Notes                                    |
| --------------------------------- | ------------------------- | ---------------------------------------- |
| `GRAILED_PROVIDER_ENABLED`        | follows authorization     | explicit provider switch                 |
| `GRAILED_SCRAPING_ALLOWED`        | `false`                   | compliance gate                          |
| `GRAILED_AUTHORIZATION_REFERENCE` | none                      | retained written-authorization reference |
| `GRAILED_BASE_URL`                | `https://www.grailed.com` | approved origin                          |
| `GRAILED_REQUEST_TIMEOUT_MS`      | `5000`                    | timeout                                  |
| `GRAILED_MIN_REQUEST_INTERVAL_MS` | `3000`                    | conservative pacing                      |
| `GRAILED_MAX_RESULTS_PER_SEARCH`  | `24`                      | normalization cap                        |
| `GRAILED_USER_AGENT`              | contact placeholder       | replace with accurate project contact    |

Do not enable Grailed without current written permission matching the request profile.

## Worker

| Variable                                   | Default                 | Bounds                                            |
| ------------------------------------------ | ----------------------- | ------------------------------------------------- |
| `WORKER_CONCURRENCY`                       | `4`                     | 1–32                                              |
| `WORKER_PROVIDER_INGESTION_ENABLED`        | `true`                  | set false only for an intentional ingestion pause |
| `WORKER_DEFAULT_INGESTION_QUERY`           | `designer clothing`     | used when no JSON schedule is supplied            |
| `WORKER_ACTIVE_INGESTION_INTERVAL_SECONDS` | `900`                   | 60–604800                                         |
| `WORKER_SOLD_INGESTION_INTERVAL_SECONDS`   | `3600`                  | 60–604800                                         |
| `WORKER_INGESTION_PAGE_SIZE`               | `50`                    | 1–200                                             |
| `WORKER_INGESTION_SEARCHES_JSON`           | empty                   | optional 1–100 validated search definitions       |
| `WORKER_LEASE_DURATION_MS`                 | `60000`                 | 5000–900000                                       |
| `WORKER_POLL_INTERVAL_MS`                  | `2000`                  | 100–60000                                         |
| `WORKER_ID`                                | generated UUID-based id | optional stable instance label                    |

The worker entry point registers maintenance handlers and, when at least one
authorized real provider is active, `provider.ingest`. It creates only the
scopes a provider reports as supported, filters fixture/mock sources, seeds
jobs idempotently, and records continuation checkpoints in PostgreSQL.

`WORKER_INGESTION_SEARCHES_JSON` is an array of objects with:
`key`, `text`, `scope` (`active` or `sold`), and optional `providerIds`,
`pageSize`, and `intervalSeconds`. Invalid JSON or invalid definitions fail
worker startup. Provider credentials and authorization flags must be supplied
to the worker as well as the API; the Compose topology does this through its
shared provider environment.

## Web build

`VITE_API_BASE_URL` is embedded into the static bundle at build time. Changing it requires a new web artifact. Production must use the public HTTPS API origin.

## Smoke tests

| Variable                             | Purpose                                          |
| ------------------------------------ | ------------------------------------------------ |
| `CLOSETSEARCH_API_BASE_URL`          | API origin to verify                             |
| `CLOSETSEARCH_SMOKE_TIMEOUT_MS`      | per-request timeout                              |
| `CLOSETSEARCH_SMOKE_REQUIRE_HTTPS`   | defaults true in production smoke                |
| `CLOSETSEARCH_EXPECTED_PROVIDER_IDS` | optional comma-separated required real providers |

`scripts/production-smoke-test.mjs` rejects non-real mode, mock fallback, active fixture providers, and mock listings.

## Backup and restore

See [PostgreSQL backup and restore](POSTGRES_BACKUP_RESTORE.md).

Backup variables:

- `BACKUP_DIR`
- `BACKUP_RETENTION_DAYS`
- `BACKUP_REQUIRE_ENCRYPTION`
- `BACKUP_AGE_RECIPIENT`

Restore variables:

- `RESTORE_DATABASE_URL`
- `RESTORE_TARGET_DATABASE`
- `RESTORE_CONFIRMATION`
- `RESTORE_AGE_IDENTITY`
