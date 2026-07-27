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
- `NOTIFICATION_DESTINATION_PEPPER` has at least 32 characters
- `AUTH_COOKIE_SECURE=true`
- `AUTH_ALLOWED_ORIGINS` contains only explicit non-local HTTPS origins
- `OPERATIONS_BEARER_TOKEN` has at least 32 characters
- `PROVIDER_RUNTIME_MODE=real`
- mock provider and fallback are disabled
- a non-disabled recommendation mode has an artifact path
- active recommendation mode has explicit promotion approval
- configured outbound delivery has HTTPS public action URLs and matching
  signed-webhook credentials

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

| Variable                   | Default                                    | Notes                                                           |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `AUTH_ALLOWED_ORIGINS`     | local Vite origins                         | explicit HTTPS production origins                               |
| `AUTH_SESSION_COOKIE_NAME` | `closetsearch_session`                     | keep stable                                                     |
| `AUTH_SESSION_TTL_DAYS`    | `14`                                       | positive integer                                                |
| `AUTH_COOKIE_SECURE`       | true in production                         | must remain true                                                |
| `AUTH_SESSION_PEPPER`      | empty                                      | production secret, minimum 32                                   |
| `AUTH_TOKEN_PEPPER`        | empty                                      | legacy fallback only                                            |
| `ACCOUNT_ACTION_BASE_URL`  | local URL / invalid production placeholder | set explicit HTTPS origin when email sender exists              |
| `OPERATIONS_BEARER_TOKEN`  | none                                       | production secret protecting metrics/operations/provider health |

Rotating session/token peppers invalidates live sessions/action links. The
account email sender uses the configured email transport;
`ACCOUNT_ACTION_BASE_URL` alone cannot activate delivery.

## Email, SMS, and alert delivery

All outbound settings default fail-closed. `capture` stores messages only in
memory for local/test use and is rejected in production.

| Variable                          | Default                                    | Notes                                                                                                         |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `EMAIL_TRANSPORT`                 | `disabled`                                 | `disabled`, local/test `capture`, or production `resend`                                                      |
| `RESEND_API_KEY`                  | none                                       | required for `EMAIL_TRANSPORT=resend`; secret                                                                 |
| `EMAIL_FROM_ADDRESS`              | none                                       | required verified Resend sender                                                                               |
| `EMAIL_WEBHOOK_SECRET`            | none                                       | raw-body Svix verification secret; minimum 32 characters when email is configured in production               |
| `SMS_TRANSPORT`                   | `disabled`                                 | `disabled`, local/test `capture`, or production `twilio`                                                      |
| `TWILIO_ACCOUNT_SID`              | none                                       | required for `SMS_TRANSPORT=twilio`                                                                           |
| `TWILIO_AUTH_TOKEN`               | none                                       | required Twilio API secret and `X-Twilio-Signature` verification key                                          |
| `TWILIO_FROM_NUMBER`              | none                                       | approved E.164 sender                                                                                         |
| `TWILIO_WEBHOOK_SECRET`           | none                                       | compatibility alias; when set it must exactly equal `TWILIO_AUTH_TOKEN`                                       |
| `ALERT_DELIVERY_ENABLED`          | false                                      | worker sends due email/SMS only when explicitly true                                                          |
| `ALERT_DELIVERY_CLAIM_TIMEOUT_MS` | `300000`                                   | stale worker-claim recovery window                                                                            |
| `ALERT_PUBLIC_BASE_URL`           | local URL / invalid production placeholder | explicit HTTPS public origin for unsubscribe and `/webhooks/*`; required for configured production transports |
| `NOTIFICATION_DESTINATION_PEPPER` | none                                       | stable production secret (minimum 32 characters) for non-reversible destination HMACs                         |

Resend account-action email also requires the auth variables above, including
HTTPS `ACCOUNT_ACTION_BASE_URL`. Twilio outbound messages set
`StatusCallback` to `/webhooks/sms` on `ALERT_PUBLIC_BASE_URL`.

Transport configuration does not opt in a user. Email/SMS delivery additionally
requires global and per-watchlist channel enablement, verified destination,
current explicit consent, and no active suppression. Do not place webhook
signatures, phone numbers, email addresses, provider response bodies, or secrets
in logs/metrics.

API and worker processes need the same auth and delivery configuration. A
destination-bound unsubscribe link is non-mutating on `GET`; only its `POST`
confirmation records opt-out and suppression.

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
| `PROVIDER_MAX_ACTIVE_PROVIDERS` | `5`                      | 1–5        |

eBay:

- `EBAY_PROVIDER_ENABLED`
- `EBAY_AUTHORIZATION_REFERENCE`
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_API_BASE_URL`
- `EBAY_IDENTITY_BASE_URL`
- `EBAY_MARKETPLACE_ID`
- `EBAY_LOCALE`
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

Depop, Yahoo! Auctions Japan, and Mercari Japan use the same suffix family
under prefixes `DEPOP`, `YAHOO_AUCTIONS_JP`, and `MERCARI_JP`:

- `<PREFIX>_PROVIDER_ENABLED`
- `<PREFIX>_SCRAPING_ALLOWED`
- `<PREFIX>_AUTHORIZATION_REFERENCE`
- `<PREFIX>_BASE_URL`
- `<PREFIX>_REQUEST_TIMEOUT_MS`
- `<PREFIX>_MIN_REQUEST_INTERVAL_MS`
- `<PREFIX>_MAX_CONCURRENCY`
- `<PREFIX>_MAX_RETRIES`
- `<PREFIX>_BASE_BACKOFF_MS`
- `<PREFIX>_MAX_RETRY_AFTER_MS`
- `<PREFIX>_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
- `<PREFIX>_CIRCUIT_BREAKER_COOLDOWN_MS`
- `<PREFIX>_MAX_RESULTS_PER_SEARCH`
- `<PREFIX>_USER_AGENT`

See [Provider configuration](PROVIDER_CONFIGURATION.md). Credentials do not
replace partner approval; Grailed flags must not be set without written
permission. Every real provider also requires a retained non-secret
authorization reference.

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

The worker also seeds `alerts.deliver_due`; it uses the email/SMS variables
above. Leaving `ALERT_DELIVERY_ENABLED` false keeps the job safely inert.

## Web

Compose assigns deterministic local image names so CI and operators scan and
promote the same release artifacts:

| Variable                    | Default                     | Notes                                     |
| --------------------------- | --------------------------- | ----------------------------------------- |
| `CLOSETSEARCH_API_IMAGE`    | `closetsearch-api:local`    | shared by the API and one-shot migration  |
| `CLOSETSEARCH_WORKER_IMAGE` | `closetsearch-worker:local` | asynchronous ingestion and alert delivery |
| `CLOSETSEARCH_WEB_IMAGE`    | `closetsearch-web:local`    | nginx-hosted browser artifact             |

Production values should be immutable registry digests from the reviewed
release. Tags are provided only for the local topology.

| Variable                             | Default   | Notes                                             |
| ------------------------------------ | --------- | ------------------------------------------------- |
| `VITE_API_BASE_URL`                  | local API | embedded at build time                            |
| `VITE_EXPERIMENTAL_METADATA_SIGNALS` | false     | keeps placeholder metadata-risk assistance hidden |

Changing either requires a new web artifact.

The Sites build always defaults `VITE_API_BASE_URL` to the same-origin `/api`
edge route. Configure the following runtime value in Sites rather than in a
committed environment file:

| Variable                  | Default | Notes                                                  |
| ------------------------- | ------- | ------------------------------------------------------ |
| `CLOSETSEARCH_API_ORIGIN` | none    | HTTPS Node API origin proxied by the Sites edge worker |

When this value is absent or invalid, the Sites edge returns `503` and never
substitutes mock inventory.

## Smoke and backup

Smoke:

- `CLOSETSEARCH_API_BASE_URL`
- `CLOSETSEARCH_SMOKE_TIMEOUT_MS`
- `CLOSETSEARCH_SMOKE_REQUIRE_HTTPS`
- `CLOSETSEARCH_EXPECTED_PROVIDER_IDS`
- `CLOSETSEARCH_OPERATIONS_BEARER_TOKEN`
- `LIVE_PROVIDER_SMOKE_TESTS` (must be exactly `true` for live marketplace smoke)

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
