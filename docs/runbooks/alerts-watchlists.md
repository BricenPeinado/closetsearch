# Alerts and Watchlists

## Active scope

ClosetSearch has resumable worker-driven watchlist matching and a durable in-app
alert inbox. It does **not** have an outbound email, push, or SMS provider.

## Watchlist criteria

An authenticated user can combine:

- label and enabled state
- query text
- canonical or provider brand
- category
- source marketplace
- listing type and market status
- exact minor-unit minimum/maximum plus currency
- size and condition
- frequency

At least one meaningful criterion is required. Maximum price cannot be lower
than minimum. Price matching uses a comparison amount only when its currency
matches the watchlist; otherwise it uses same-currency original money or does
not match.

## Ingestion and matching

For each new or changed persisted provider observation, the worker calls the
PostgreSQL matcher. It:

- examines enabled watchlists
- evaluates query/brand/category/source/type/status/size/condition/price
- records explainable reason codes
- upserts one match per watchlist/listing
- updates `last_matched_at` without duplicating the inbox entry

Mock fixtures are never worker ingestion sources.

## Inbox lifecycle

Routes:

- `GET /me/alerts`
- `POST /me/alerts/seen`
- `POST /me/alerts/dismiss`
- compatibility read: `GET /me/alert-matches`

State:

- `unseen`
- `seen`
- `dismissed`

Mutations require an alert-match UUID and session ownership. Client-supplied
user IDs are rejected.

When in-app delivery is enabled, the matcher records an idempotent delivered
`in_app` delivery row at match time. The inbox response reports unseen count.

## Scheduling and delivery records

The data plane implements:

- `instant`, `hourly`, `daily`, and `weekly` cadence
- timezone-aware quiet-hour deferral
- hashed destination
- queued/processing/delivered/retry-wait/failed/suppressed/dead-letter states
- atomic due-delivery claim
- attempt count, retry timestamp, bounded error, and provider message ID
- default dead letter after five failed attempts

These repository operations are ready for an outbound worker, but no outbound
delivery handler/provider is registered. Production request validation rejects
enabling email, push, or SMS.

## Notification preferences

In-app enablement is meaningful now and does not delay inbox matches for quiet
hours or digest cadence. Frequency, timezone, and quiet hours are persisted and
enforced when the repository computes a future email attempt, but have no
observable outbound effect until an email handler/provider is implemented.
Email also requires a verified address; neither a preference nor a queued schema
row proves a message was sent.

Push and SMS remain disabled and intentionally deferred.

## Recovery and operations

Monitor:

- ingestion checkpoint age
- matches created and duplicate rate
- unseen inbox growth
- queued/retry-wait/dead-letter delivery counts
- repeated watchlist noise and provider concentration

On a worker crash, leases expire and jobs resume from durable provider
checkpoints. Do not delete matches/checkpoints to “unstick” a job without a
reviewed recovery plan.

## Verification

Tests cover matching criteria/currency, idempotency, seen/dismissed ownership,
frequency/quiet-hour computation, delivery claim/retry/dead-letter state, worker
resume/duplicate ingestion, and channel-disable enforcement.

Activation of outbound email additionally requires a verified sender/address,
provider adapter, suppression/bounce policy, retry worker, staging delivery
evidence, and updated privacy/retention documentation.
