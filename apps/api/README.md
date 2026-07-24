# API App

`@closetsearch/api` is the HTTP, persistence, and background-work boundary.

Implemented responsibilities:

- normalized feed/search/provider orchestration and degraded-state reporting
- cookie auth, onboarding, account verification/recovery/export/deletion
- likes, recent/saved searches, filters, watchlists, settings, and alert inbox
- PostgreSQL durable engagement, entitlements, listings, price history, jobs,
  provider health, alerts, ML metadata, and operations state
- observed analytics and guarded recommendation inference
- liveness/readiness, Prometheus metrics, redacted PostgreSQL-backed
  `/operations/status`, request IDs, security headers, body limits, origin/CSRF
  checks, rate limits, redacted logs, and graceful shutdown
- a separate worker entry point for resumable provider ingestion and maintenance
- a validated external contract in [`openapi.json`](openapi.json)

Key commands:

```sh
corepack pnpm --filter @closetsearch/api dev
corepack pnpm --filter @closetsearch/api test
corepack pnpm --filter @closetsearch/api test:integration
corepack pnpm --filter @closetsearch/api db:migrate:postgres
corepack pnpm --filter @closetsearch/api worker
```

Production requires PostgreSQL. Root `db:migrate` is the PostgreSQL migration
job. Use root `db:migrate:sqlite` and `db:seed:sqlite` only for local/test
compatibility.

The eBay and Grailed adapters are implemented but not authorized/configured live
in this checkout. Production does not fall back to mock inventory.
