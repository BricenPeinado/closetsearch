# ClosetSearch

ClosetSearch is a fashion-resale discovery monorepo. It normalizes marketplace
listings behind provider adapters, serves feed/search/account/analytics APIs,
renders a React/Vite web product, and runs resumable PostgreSQL-backed ingestion
work separately from the request process.

## Current status

The repository now contains substantially more than a preview scaffold:

- normalized exact-money, lifecycle, seller, shipping, attribution, freshness,
  and analytics-eligibility listing contracts
- deterministic multi-provider orchestration with per-provider continuation,
  conservative deduplication, partial-failure summaries, rate limiting, bounded
  retry/circuit behavior, and stale-while-revalidate caching
- a fixture-only mock provider plus eBay, Grailed, Depop, Yahoo! Auctions Japan,
  and Mercari Japan adapters, each locked behind credentials and/or a retained
  provider-specific authorization reference
- PostgreSQL as the required production persistence driver, with pooled access,
  transaction retry, checksummed forward migrations, drift detection, durable
  request state, listing history, jobs, engagement, alerts, entitlements, and ML
  metadata tables
- a separate worker entry point with database leases, crash-resumable
  checkpoints, provider ingestion, idempotent listing upserts, deterministic
  price history, stale-state maintenance, engagement rollups, and watchlist
  matching
- cookie-backed sessions, CSRF-origin checks, request limits, password policy,
  verified-email/password-reset/export/delete API and web flows, and production
  startup invariants
- qualified client-originated engagement events: a listing impression requires
  at least one second at 50% viewport visibility
- persisted premium entitlements and a non-production administrative grant path;
  there is no configured billing provider
- in-app alert matching, inbox, seen/dismissed state, plus durable
  quiet-hour/frequency-aware email and SMS delivery with explicit consent,
  verified destinations, suppression, signed webhooks, crash recovery, and a
  fail-closed global gate; push remains unavailable
- an offline reproducible ML package plus a guarded API recommendation runtime;
  the rules ranker remains authoritative because the checked-in candidate is not
  promotion-eligible
- a published, test-validated API contract at
  [`apps/api/openapi.json`](apps/api/openapi.json)
- Prometheus metrics plus a redacted PostgreSQL-backed operations-status view
  for provider health, ingestion checkpoints, and durable jobs
- API, web, worker, PostgreSQL, migration, backup, and reverse-proxy deployment
  artifacts, CI gates, Playwright flows, production smoke checks, and rollback
  runbooks

ClosetSearch is still **blocked from a truthful live production launch** in this
checkout. eBay production credentials/approval and all five provider-specific
authorization references are absent. Production fails closed: mock inventory
cannot silently replace unavailable real providers.

See the [implementation report](docs/implementation-report.md), the immutable
[pre-implementation gap matrix](docs/production-gap-matrix.md), and the
[provider acquisition matrix](docs/provider-acquisition-matrix.md).

## Repository layout

```text
apps/
  api/          TypeScript HTTP API, PostgreSQL data plane, and worker
  web/          React/Vite product
packages/
  shared/       normalized product contracts
  providers/    mock plus five marketplace and resilient HTTP adapters
  ml/           offline deterministic training/evaluation package
docs/
  ml/           dataset/model cards and fixture evaluation
  runbooks/     operations, provider, database, auth, and release guidance
tests/e2e/      Playwright browser flows
```

## Local development

Requires Node 24.x and Corepack/pnpm.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

The default non-production provider mode is mock and the default local/test
persistence option is SQLite. Fixture listings are visibly marked as mock and
must never be presented as live marketplace inventory.

For the production-like topology:

```sh
cp .env.compose.example .env.compose
docker compose --env-file .env.compose config --quiet
docker compose --env-file .env.compose up -d postgres migrate api worker web
```

The example intentionally disables mock inventory. Without authorized provider
configuration, feed/search readiness or results can be unavailable.

## Quality commands

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
corepack pnpm test:sites
corepack pnpm test:integration
corepack pnpm test:e2e
corepack pnpm infrastructure:check
corepack pnpm deps:check
corepack pnpm db:migrate
corepack pnpm smoke:test
```

`db:migrate` is the production PostgreSQL migration command and requires
`DATABASE_URL`. SQLite compatibility commands are explicit:

```sh
corepack pnpm db:migrate:sqlite
corepack pnpm db:seed:sqlite
```

The fast PostgreSQL integration harness uses `pg-mem`. A separately gated suite
uses `POSTGRES_INTEGRATION_DATABASE_URL` for prior-schema upgrades, real
concurrent upserts/rollback, worker lease contention, and session persistence.
CI starts PostgreSQL 17 for those tests, migration, PostgreSQL-backed Playwright,
and backup/restore evidence. An ephemeral local PostgreSQL 17.10 run also
verified migrations `001`–`006`, the six real-engine reliability cases, the
full API suite, PostgreSQL-backed Playwright, and an isolated logical
backup/restore with checksum verification. Docker remains unavailable, so no
local Compose claim is made.

## Production invariants

- `PERSISTENCE_DRIVER=postgres`
- `PROVIDER_RUNTIME_MODE=real`
- `PROVIDER_ALLOW_MOCK_FALLBACK=false`
- `PROVIDER_MOCK_ENABLED=false`
- secure cookies, explicit HTTPS origins, and a secret session pepper
- a dedicated secret bearer token for metrics and operational/provider health
- an authorized/configured real provider must pass readiness
- migrations run as a one-shot deployment job
- ML remains `disabled` or `shadow` unless an immutable promoted artifact and an
  explicit promotion approval are both present

Start with the [production deployment runbook](docs/runbooks/PRODUCTION_DEPLOYMENT.md),
[environment reference](docs/runbooks/environment.md), and
[rollback runbook](docs/runbooks/PRODUCTION_ROLLBACK.md).

## Product boundaries

- Pricing analytics are observed comparable context, not investment advice or a
  guaranteed bargain claim.
- The fair-value candidate is not active.
- Placeholder authenticity/fake-risk scoring is not a production verdict and
  must not drive ranking, blocking, or filtering.
- No billing provider is configured.
- No outbound email, push, or SMS provider is configured.
- An implemented adapter or recorded fixture is not proof of marketplace
  authorization.

Roadmap truth lives in [TASKS.md](TASKS.md); durable architecture decisions live
in [DECISIONS.md](DECISIONS.md).
