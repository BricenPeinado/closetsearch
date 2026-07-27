# Alerts and Watchlists

## Active scope

ClosetSearch has resumable worker-driven watchlist matching and a durable in-app
alert inbox. It also has fail-closed Resend email and Twilio SMS transport
implementations, but this checkout has no production transport credentials,
verified sender/number, webhook-signing credentials, public callback origin, or
user consent. Outbound delivery is therefore inactive. Push is not implemented.

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
- event types: new listing, price drop, auction ending, or back in range
- independently enabled in-app, email, and SMS channels

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
- upserts one match per watchlist/listing/event and resets it to unseen for a
  genuinely new event trigger
- updates `last_matched_at` without duplicating replayed triggers

Mock fixtures are never worker ingestion sources. Matching is also passed an
explicit current provider-authorization decision and fails closed, including
for in-app alerts, if the provider was disabled or its authorization was
revoked between fetch and match.

Digest summaries remain an optional future delivery mode; they are not exposed
as a configurable event until a durable aggregation/scheduling job exists.

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

## Preferences, readiness, and consent

Routes:

- `GET /me/notification-preferences`
- `PATCH /me/notification-preferences`
- `GET /me/notification-readiness`
- `GET|PATCH /me/watchlists/:watchlistId/alert-settings`
- `PUT|DELETE /me/phone`
- `POST /me/phone/verification`
- `POST /me/phone/verify`
- `GET|POST /notifications/unsubscribe?token=...`

In-app defaults on. Global and per-watchlist email/SMS flags default off. An
outbound row is eligible only when all of these remain true:

1. the channel transport is configured and worker delivery is enabled
2. the user's global channel setting is on
3. that watchlist's channel setting is on
4. the destination is present and verified
5. a current explicit opt-in consent event exists
6. the destination is not suppressed
7. the event type is enabled and cadence/quiet-hour timing is due

Email uses the verified account email. SMS phone entry requires an explicit
consent acknowledgement, accepts only normalized E.164, and sends a rate-limited
six-digit challenge that expires after ten minutes. Codes are stored only as
purpose-bound hashes. Delivery rechecks consent and suppression after claiming a
row so a recent opt-out wins over an older queued attempt.

## Scheduling and delivery

The data plane implements:

- `instant`, `hourly`, `daily`, and `weekly` cadence
- timezone-aware quiet-hour deferral
- hashed destination
- queued/processing/delivered/retry-wait/failed/suppressed/dead-letter states
- atomic due-delivery claim
- attempt count, retry timestamp, bounded error, and provider message ID
- default dead letter after five failed attempts

The worker seeds `alerts.deliver_due`. It is inert unless
`ALERT_DELIVERY_ENABLED=true`; production startup then requires at least one
configured email or SMS transport. Resend and Twilio requests use bounded
timeouts and idempotency keys. Only bounded provider status metadata is stored;
credentials, raw destinations, and raw provider error bodies must not be logged
or copied into durable error fields.

Email delivery includes one-click `List-Unsubscribe` headers and a signed,
expiring, destination-bound public unsubscribe URL. A browser `GET` only
validates the token and asks for confirmation; the `POST` records opt-out and
suppression. SMS messages identify ClosetSearch and include STOP instructions.

## Webhooks and suppression

Routes:

- `POST /webhooks/email`
- `POST /webhooks/sms`

The Resend endpoint verifies the raw request body with the configured Svix
secret, rejects clock-skewed/invalid signatures, and deduplicates `svix-id`.
Bounces, complaints, and terminal address failures suppress the destination and
disable email for the matched user.

The Twilio endpoint verifies `X-Twilio-Signature` using the exact public
`/webhooks/sms` URL derived from `ALERT_PUBLIC_BASE_URL`, deduplicates message
SIDs, consumes delivery failures, and handles inbound STOP/UNSUBSCRIBE/CANCEL,
START/UNSTOP, and HELP. STOP and provider code `21610` record opt-out, suppress
the destination, and disable SMS. START records a new opt-in and releases only
STOP suppression; the channel is re-enabled only for a verified identity.
Responses use TwiML.

Webhook payloads are represented durably by a SHA-256 digest plus bounded
provider/event metadata, not raw bodies.

## Required activation configuration

Email:

- `EMAIL_TRANSPORT=resend`
- `RESEND_API_KEY`
- `EMAIL_FROM_ADDRESS`
- `EMAIL_WEBHOOK_SECRET` (minimum 32 characters in production)
- HTTPS `ACCOUNT_ACTION_BASE_URL` and `ALERT_PUBLIC_BASE_URL`

SMS:

- `SMS_TRANSPORT=twilio`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- optional compatibility `TWILIO_WEBHOOK_SECRET`; when set, it must exactly
  equal `TWILIO_AUTH_TOKEN`
- HTTPS `ALERT_PUBLIC_BASE_URL`

For either channel, also set `ALERT_DELIVERY_ENABLED=true` in the worker. The
`capture` transport is local/test only and is rejected in production.
`ALERT_DELIVERY_CLAIM_TIMEOUT_MS` controls bounded recovery of abandoned
delivery claims (default five minutes). Production also requires a stable
secret-managed `NOTIFICATION_DESTINATION_PEPPER` of at least 32 characters for
keyed, non-reversible destination hashes; rotating it invalidates existing
consent/suppression lookups and must be treated as a migration.

## Recovery and operations

Monitor:

- ingestion checkpoint age
- matches created and duplicate rate
- unseen inbox growth
- queued/retry-wait/dead-letter delivery counts
- consent/opt-out and suppression growth by bounded reason/channel
- invalid/replayed webhook signature rates without logging signatures or bodies
- repeated watchlist noise and provider concentration

On a worker crash, leases expire and jobs resume from durable provider
checkpoints. Do not delete matches/checkpoints to “unstick” a job without a
reviewed recovery plan.

## Verification

Tests cover matching criteria/currency, idempotency, seen/dismissed ownership,
frequency/quiet-hour computation, delivery claim/retry/dead-letter state, worker
resume/duplicate ingestion, opt-in defaults, delivery-time consent and
suppression, phone verification, unsubscribe/STOP, Resend/Twilio transport
mapping, webhook signatures/replay, and channel-disable enforcement.

Activation additionally requires verified production senders and user
destinations, provider credentials, signed callback configuration, consent and
suppression policy review, staging delivery evidence, approved privacy/
retention/subprocessor documentation, and operational alerts. No schema row,
preference, accepted provider response, or fixture proves a human received a
message.
