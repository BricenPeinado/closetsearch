# Environment Reference

Examples:

- root development: `.env.example`
- API/worker: `apps/api/.env.example`
- web build: `apps/web/.env.example`
- local topology: `.env.compose.example`

Examples contain placeholders, not production secrets. Use a secret manager.

## Production invariants

The API rejects production startup unless:

- `PERSISTENCE_DRIVER=postgres`
- `DATABASE_URL` is valid
- `AUTH_SESSION_PEPPER` has at least 32 characters
- `AUTH_COOKIE_SECURE=true`
- `AUTH_ALLOWED_ORIGINS` contains only explicit non-local HTTPS origins
- `PROVIDER_RUNTIME_MODE=real`
- mock provider and fallback are disabled
- a non-disabled recommendation mode has an artifact path
- active recommendation mode has explicit promotion approval

Readiness additionally requires successful PostgreSQL access, no migration
drift/pending version, and at least one active real provider.

## API process

| Variable                | Default               | Notes                                      |
| ----------------------- | --------------------- | ------------------------------------------ |
| `NODE_ENV`              | runtime               | set `production`                           |
| `HOST`                  | `127.0.0.1`           | platform bind address                      |
| `PORT`                  | `4000`                | 1–65535                                    |
| `SHUTDOWN_TIMEOUT_MS`   | `10000`               | 1000–60000                                 |
| `PERSISTENCE_DRIVER`    | required except tests | `postgres` production, `sqlite` local/test |
| `CLOSETSEARCH_DB_PATH`  | local `.data` file    | SQLite compatibility only                  |
| `HTTP_BODY_LIMIT_BYTES` | `65536`               | streamed JSON limit                        |

## PostgreSQL

| Variable                           | Default                 | Notes                                         |
| ---------------------------------- | ----------------------- | --------------------------------------------- |
| `DATABASE_URL`                     | none                    | required for PostgreSQL                       |
| `POSTGRES_APPLICATION_NAME`        | `closetsearch-api`      | use distinct API/worker/migration labels      |
| `POSTGRES_SSL_MODE`                | `prefer`                | `disable`, `prefer`, `require`, `verify-full` |
| `POSTGRES_SSL_CA`                  | none                    | CA PEM; escaped newlines accepted             |
| `POSTGRES_ALLOW_INSECURE`          | false                   | local/CI-only override for disabled TLS       |
| `POSTGRES_POOL_MAX`                | `10`                    | 1–100, budget across replicas                 |
| `POSTGRES_CONNECTION_TIMEOUT_MS`   | `5000`                  | 100–120000                                    |
| `POSTGRES_IDLE_TIMEOUT_MS`         | `30000`                 | 1000–600000                                   |
| `POSTGRES_STATEMENT_TIMEOUT_MS`    | `10000`                 | 100–300000                                    |
| `POSTGRES_QUERY_TIMEOUT_MS`        | `12000`                 | 100–300000                                    |
| `POSTGRES_TRANSACTION_RETRY_LIMIT` | `3`                     | 0–10                                          |
| `PERSISTENCE_MIGRATE_ON_START`     | true outside production | production should use one-shot migration      |
| `REQUEST_STORE_IP_HINT_PEPPER`     | session pepper fallback | separate production secret is preferred       |

Use `verify-full` with a trusted CA in managed production. Disabled TLS is only
for isolated local/CI networking.

## Auth and account actions

| Variable                   | Default                                    | Notes                                              |
| -------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `AUTH_ALLOWED_ORIGINS`     | local Vite origins                         | explicit HTTPS production origins                  |
| `AUTH_SESSION_COOKIE_NAME` | `closetsearch_session`                     | keep stable                                        |
| `AUTH_SESSION_TTL_DAYS`    | `14`                                       | positive integer                                   |
| `AUTH_COOKIE_SECURE`       | true in production                         | must remain true                                   |
| `AUTH_SESSION_PEPPER`      | empty                                      | production secret, minimum 32                      |
| `AUTH_TOKEN_PEPPER`        | empty                                      | legacy fallback only                               |
| `ACCOUNT_ACTION_BASE_URL`  | local URL / invalid production placeholder | set explicit HTTPS origin when email sender exists |

Rotating session/token peppers invalidates live sessions/action links. The
repository does not configure an account email sender; `ACCOUNT_ACTION_BASE_URL`
alone cannot activate delivery.

## Engagement

| Variable                         | Default                | Notes                         |
| -------------------------------- | ---------------------- | ----------------------------- |
| `ENGAGEMENT_SESSION_PEPPER`      | development value only | production secret, minimum 32 |
| `ENGAGEMENT_MAX_EVENT_AGE_MS`    | `604800000`            | 1 minute–30 days              |
| `ENGAGEMENT_FUTURE_TOLERANCE_MS` | `300000`               | 0–1 hour                      |

Privacy-session IDs and normalized search text are hashed before persistence.

## Entitlements

`ENTITLEMENT_ADMIN_DEVELOPMENT_ENABLED=true` permits the development grant route
only outside production and only for a session user with a verified `admin`
identity. Development entitlements are ignored in production. No billing
environment is defined because no billing provider is integrated.

## Recommendation runtime

| Variable                                            | Default    | Notes                                      |
| --------------------------------------------------- | ---------- | ------------------------------------------ |
| `CLOSETSEARCH_RECOMMENDATION_MODE`                  | `disabled` | `disabled`, `shadow`, `active`             |
| `CLOSETSEARCH_RECOMMENDATION_ARTIFACT_PATH`         | none       | immutable reviewed JSON                    |
| `CLOSETSEARCH_RECOMMENDATION_PROMOTION_APPROVED`    | `false`    | required with promoted artifact for active |
| `CLOSETSEARCH_RECOMMENDATION_TIMEOUT_MS`            | `25`       | 1–250                                      |
| `CLOSETSEARCH_RECOMMENDATION_MAX_ARTIFACT_AGE_DAYS` | `45`       | 1–365                                      |

The checked-in synthetic artifact is shadow evidence, not a production artifact.
Rollback to `disabled` or `shadow`.

## Providers

Core:

| Variable                        | Development              | Production |
| ------------------------------- | ------------------------ | ---------- |
| `PROVIDER_RUNTIME_MODE`         | `mock` unless configured | `real`     |
| `PROVIDER_ALLOW_MOCK_FALLBACK`  | `true`                   | `false`    |
| `PROVIDER_MOCK_ENABLED`         | `true`                   | `false`    |
| `PROVIDER_REQUEST_TIMEOUT_MS`   | `10000`                  | 1000–60000 |
| `PROVIDER_MAX_ACTIVE_PROVIDERS` | `2`                      | 1–5        |

eBay:

- `EBAY_PROVIDER_ENABLED`
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_API_BASE_URL`
- `EBAY_IDENTITY_BASE_URL`
- `EBAY_MARKETPLACE_ID`
- `EBAY_OAUTH_SCOPE`
- `EBAY_AFFILIATE_CAMPAIGN_ID`
- `EBAY_AFFILIATE_REFERENCE_ID`
- `EBAY_REQUEST_TIMEOUT_MS`
- `EBAY_MIN_REQUEST_INTERVAL_MS`
- `EBAY_MAX_CONCURRENCY`
- `EBAY_MAX_RETRIES`

Grailed:

- `GRAILED_PROVIDER_ENABLED`
- `GRAILED_SCRAPING_ALLOWED`
- `GRAILED_AUTHORIZATION_REFERENCE`
- `GRAILED_BASE_URL`
- `GRAILED_REQUEST_TIMEOUT_MS`
- `GRAILED_MIN_REQUEST_INTERVAL_MS`
- `GRAILED_MAX_CONCURRENCY`
- `GRAILED_MAX_RETRIES`
- `GRAILED_BASE_BACKOFF_MS`
- `GRAILED_MAX_RETRY_AFTER_MS`
- `GRAILED_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
- `GRAILED_CIRCUIT_BREAKER_COOLDOWN_MS`
- `GRAILED_MAX_RESULTS_PER_SEARCH`
- `GRAILED_USER_AGENT`

See [Provider configuration](PROVIDER_CONFIGURATION.md). Credentials do not
replace partner approval; Grailed flags must not be set without written
permission.

## Worker

| Variable                                   | Default             | Bounds                         |
| ------------------------------------------ | ------------------- | ------------------------------ |
| `WORKER_CONCURRENCY`                       | `4`                 | 1–32                           |
| `WORKER_PROVIDER_INGESTION_ENABLED`        | `true`              | explicit pause only            |
| `WORKER_DEFAULT_INGESTION_QUERY`           | `designer clothing` | fallback schedule text         |
| `WORKER_ACTIVE_INGESTION_INTERVAL_SECONDS` | `900`               | 60–604800                      |
| `WORKER_SOLD_INGESTION_INTERVAL_SECONDS`   | `3600`              | 60–604800                      |
| `WORKER_INGESTION_PAGE_SIZE`               | `50`                | 1–200                          |
| `WORKER_INGESTION_SEARCHES_JSON`           | empty               | 1–100 definitions              |
| `WORKER_LEASE_DURATION_MS`                 | `60000`             | 5000–900000                    |
| `WORKER_POLL_INTERVAL_MS`                  | `2000`              | 100–60000                      |
| `WORKER_ID`                                | generated           | optional stable instance label |

Each search definition has `key`, `text`, `scope` (`active` or `sold`), and
optional `providerIds`, `pageSize`, and `intervalSeconds`. Invalid definitions
fail worker startup. The worker needs the same provider authorization/credentials
as the API.

## Web

| Variable                             | Default   | Notes                                             |
| ------------------------------------ | --------- | ------------------------------------------------- |
| `VITE_API_BASE_URL`                  | local API | embedded at build time                            |
| `VITE_EXPERIMENTAL_METADATA_SIGNALS` | false     | keeps placeholder metadata-risk assistance hidden |

Changing either requires a new web artifact.

## Smoke and backup

Smoke:

- `CLOSETSEARCH_API_BASE_URL`
- `CLOSETSEARCH_SMOKE_TIMEOUT_MS`
- `CLOSETSEARCH_SMOKE_REQUIRE_HTTPS`
- `CLOSETSEARCH_EXPECTED_PROVIDER_IDS`

Backup:

- `BACKUP_DIR`
- `BACKUP_RETENTION_DAYS`
- `BACKUP_REQUIRE_ENCRYPTION`
- `BACKUP_AGE_RECIPIENT`

Restore:

- `RESTORE_DATABASE_URL`
- `RESTORE_TARGET_DATABASE`
- `RESTORE_CONFIRMATION`
- `RESTORE_AGE_IDENTITY`

See [PostgreSQL backup and restore](POSTGRES_BACKUP_RESTORE.md).
