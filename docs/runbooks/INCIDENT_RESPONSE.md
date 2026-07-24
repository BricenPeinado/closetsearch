# Incident Response

## Severity

- **SEV-1:** security exposure, destructive data loss/corruption, widespread auth failure, or unsafe production inventory substitution
- **SEV-2:** major feed/search outage, database unavailability, stuck ingestion/alerts, or one critical provider failing without usable partial results
- **SEV-3:** degraded non-critical feature, isolated provider errors, delayed background work within recovery objectives

Assign an incident commander, operations lead, communications owner, and scribe for SEV-1/2. Preserve a timestamped decision log.

## First 15 minutes

1. Confirm impact and declare severity.
2. Stop the rollout or risky maintenance operation.
3. Capture:
   - API `/health/live`, `/health/ready`, `/operations/status`,
     `/providers/health`
   - deployment/image digests and schema version
   - request ids and redacted structured logs
   - PostgreSQL pool/error/retry state
   - worker job failures, lease loss, last success, and ingestion lag
4. Check for secrets or personal data in logs. If present, restrict access and begin rotation/notification assessment.
5. Choose containment: rollback image, disable one real provider, pause workers, or freeze writes.

Never bypass provider controls, rotate identities, or enable mock fallback to conceal a production provider outage.

## Scenario guides

### Database unavailable or saturated

- stop non-essential workers to reduce pressure
- verify provider/database service status and connection limits
- inspect pool saturation, slow queries, lock contention, and transient retry count
- do not increase pool sizes blindly; total all replica pools first
- fail readiness while durable operations are unsafe
- use application rollback before database restore when schema remains valid

### Migration failure or drift

- keep old application traffic in place
- do not edit an applied migration checksum
- capture `postgres_schema_migrations` and the candidate migration artifact
- correct with a new forward migration
- escalate checksum drift as a release-integrity incident

### Worker or ingestion lag

- inspect the sanitized operations endpoint plus last-success, retry,
  dead-letter, lease, and provider-health records
- treat `operations_state_unavailable` as loss of operational visibility, not
  proof that jobs/providers are healthy
- stop duplicate worker deployments if lease contention is abnormal
- confirm checkpoints before retrying
- do not reset checkpoints or delete jobs without an explicit recovery plan
- inspect the `worker_jobs_seeded` event for expected `activeProviderIds` and
  unexpected `blockedProviders`
- confirm the worker received the same provider authorization/configuration as
  the API; never add credentials merely to conceal an external authorization
  blocker

### Provider outage/rate limit

- honor `Retry-After`, circuit breakers, and authorization boundaries
- disable only the affected provider if needed
- show explicit degraded/partial state
- never replace production results with mock inventory

### Auth or suspected credential compromise

- pause affected endpoints if necessary
- rotate compromised provider/database/session secrets through secret management
- understand that session-pepper rotation revokes all sessions
- preserve forensic evidence without copying raw secrets into tickets
- follow privacy/legal notification requirements

### Account email or alert incident

- distinguish the in-app inbox from outbound delivery
- disable the outbound provider/worker without deleting alert matches
- preserve delivery idempotency keys, attempt/dead-letter state, and provider
  message IDs without exposing destinations
- never mark a queued/failed attempt as delivered to quiet an alert

### Recommendation or analytics regression

- set recommendation mode to `disabled` or `shadow`; rules remain available
- retain artifact/model/feature versions and fallback/latency/concentration
  metrics
- keep asking and sold observations separate
- fall back to observed ranges when model confidence, calibration, drift, or
  freshness is unsafe

## Communications

State confirmed user impact, affected time window, current containment, and next update time. Do not speculate about data loss, provider fault, or recovery time.

## Recovery and closure

- run production no-mock smoke checks
- verify database schema and critical row counts
- verify worker/job progress and provider health
- observe through at least one normal scheduling interval
- document timeline, root cause, contributing controls, user impact, detection gaps, and corrective owners/dates
- schedule backup restore evidence when the incident touched persistence
