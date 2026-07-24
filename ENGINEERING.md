# Engineering Standards

## Boundaries

- `packages/shared` owns normalized, framework-independent product contracts.
- `packages/providers` owns raw provider types, networking, capability reporting,
  normalization, and fixture contract tests.
- `packages/ml` owns offline snapshots, training, artifact schemas, evaluation,
  and promotion gates; it does not query production data or train in requests.
- `apps/api` owns HTTP contracts, provider orchestration, persistence,
  entitlements, analytics, auth, and worker entry points.
- `apps/web` owns presentation and client-originated interaction measurement.

Raw provider payloads must not leave an adapter. Raw user feature vectors,
credentials, session tokens, one-time tokens, database URLs, and confidential
authorization artifacts must not enter logs or client responses.

## Data and persistence

- PostgreSQL is mandatory in production; SQLite is an explicit local/test
  compatibility implementation.
- Store money as integer minor units with an ISO-style three-letter currency.
- Never compare or sort amounts across currencies without a conversion rate,
  source, and timestamp.
- Use foreign keys, uniqueness, checks, and transactions to enforce invariants.
- Idempotent ingestion requires provider/source identity plus an ingestion event
  key.
- Treat provider-normalized server output as the catalog authority. A browser
  may reference a listing ID, but its listing snapshot must not create or mutate
  catalog, status, or price history.
- Exact observation replays deduplicate; a later collection of unchanged data
  must refresh listing freshness without adding a price change.
- Latest price state must order by a monotonic observation/version key, not a
  timestamp alone.
- Applied migrations are immutable. Add a forward migration; never edit an
  applied checksum or rely on destructive down migrations.
- Production migrations run once before rollout. API replicas must not race
  schema ownership.

## Providers

- Acquisition priority is official API, partner API, documented feed, then
  explicitly authorized scraping.
- An implementation, credential, fixture, or technically reachable endpoint is
  not legal authorization.
- Never bypass auth, CAPTCHA, robots restrictions, rate limits, or access
  controls; never rotate identities/proxies to evade enforcement.
- Production is fail closed: no mock activation or silent fallback.
- Timeouts, bounded retry, `Retry-After`, pacing, circuit state, structured
  latency/health, deterministic pagination, and explicit partial failures are
  required.
- Keep each provider/runtime instance alive across API requests so its pacing,
  concurrency, circuit, credential, and cache state remains effective.
- Normal tests must use recorded/redacted fixtures and must not call a live
  marketplace.

## API and security

- Validate request bodies and enforce a bounded body size.
- Derive identity only from the authenticated session; reject spoofed user IDs.
- Cookie mutations enforce trusted-origin/CSRF checks.
- Passwords use the central policy and slow hash service.
- Store only hashes of sessions and one-time action tokens.
- Use consistent error codes, request IDs, security headers, redacted structured
  logs, rate limits, readiness/liveness, and graceful shutdown.
- Update and validate `apps/api/openapi.json` when external behavior changes.

## Engagement and ML

- A server response is not an impression. Client impressions must satisfy the
  documented viewport threshold and carry a dedupe event ID.
- Aggregate durable events outside feed request scans.
- Temporal ML splits must prevent future leakage.
- Artifacts carry model version, feature-schema version, seed, dataset
  fingerprint, lifecycle, and evaluation.
- Rules-based recommendation and observed-range market analysis remain
  independent fallbacks.
- Model promotion requires explicit approval and all documented relevance,
  diversity/concentration, latency, calibration, sample, staleness, and drift
  gates.
- Do not expose sensitive feature values in debug endpoints.

## Workflow and verification

- Preserve working behavior and land small, reviewable commits.
- Keep external activation blockers separate from internal implementation
  status.
- Add regression evidence with every bug fix.
- Use `apply_patch` for intentional source/document edits; formatters may perform
  mechanical rewrites.
- Preserve unrelated work in a dirty tree.

Required release gates are listed in the root
[README](README.md#quality-commands). A phase is not complete because it has an
interface or fixture; its executable evidence and current limitations must be
recorded.

## Operational truthfulness

- Local `pg-mem` tests validate repository semantics but do not replace a real
  PostgreSQL migration/concurrency/restore drill.
- Static container validation does not replace a Compose boot.
- Fixture evaluation does not estimate production ML performance.
- A provider adapter is not a live provider until authorized credentials and a
  non-mock smoke test succeed.
- Documentation must classify work as foundation complete, production
  implementation complete, externally blocked, or intentionally deferred.
