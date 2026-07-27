# ClosetSearch Data-Use Draft

This is operational engineering guidance, not approved legal terms.

## Permitted product use

User-owned data supports sessions, account recovery/export/deletion, saved
features, in-app watchlist alerts, explicitly opted-in transactional email/SMS
alerts, entitlement authorization, and explainable personalization.

Qualified, deduplicated engagement supports aggregate popularity and user
recommendation features. Do not collect unnecessary direct identifiers or
secrets in events.

Marketplace observations support discovery, lifecycle tracking, price history,
watchlist matching, and cautious analytics only within each provider's approved
display, caching, retention, derivation, attribution, and ML terms.

## Provider rule

Use official API, approved partner API, documented feed, or explicitly
authorized scraping in that order. Never bypass access controls or technical
enforcement. An adapter/fixture does not prove permission. See the
[provider acquisition matrix](../provider-acquisition-matrix.md).

## Analytics and ML limits

- keep currencies exact and separate unless a sourced/timestamped conversion
  exists
- keep asking and confirmed sold outcomes distinct
- do not treat an active asking price as a realized target
- use temporal evaluation and deletion-aware feature snapshots
- keep rules/observed fallback
- do not expose sensitive features
- do not claim profit, investment, guaranteed value, future certainty, or
  authentic/fake verdicts

Current ML candidates are not promoted.

Price trends are descriptive summaries of retained observations in a single
currency. Keep asking, current-bid, completed-auction, and confirmed-sold
evidence distinct. Do not infer that an auction sold when completed-price
evidence is missing.

## Account rights

The implemented one-time export excludes credential/token hashes. Export support
for phone identity and notification-consent/suppression history is being
extended in the current working tree and must be rechecked against the final
schema, API payload, and tests before SMS launch; do not claim it complete from
this reconciliation alone. Confirmed deletion cascades the phone identity and
other directly user-owned state and removes the user association from raw
engagement. Consent/suppression rows retain a hashed destination with the user
association set to null for compliance evidence; provider-wide catalog history
and pseudonymous events/aggregates also remain. Final legal policy, export scope,
and retention/deletion enforcement still require approval.

## Alerts and billing

In-app alerts are active. Resend email and Twilio SMS transports are implemented
but default off. Email alerts require an approved verified sender, a verified
account address, separate current opt-in, and per-watchlist enablement. SMS
requires an approved sender, explicit phone-entry consent, successful phone
verification, current opt-in, and per-watchlist enablement. Delivery rechecks
consent and suppression. Email unsubscribe and SMS STOP must take effect before
later queued sends; bounces, complaints, invalid destinations, and SMS delivery
failures suppress the affected destination. Push is disabled.

Treat Resend and Twilio as subprocessors only if they are actually configured,
and publish that fact before activation. Retain only the bounded delivery,
consent, suppression, and signed-webhook evidence required for operations and
lawful compliance; do not persist raw webhook bodies or expose destinations in
logs/metrics.

No billing provider is configured, and a development entitlement must not be
described as a subscription.

## Prohibited uses

- credential/session/token logging
- email addresses, phone numbers, webhook signatures/bodies, verification
  codes, or notification-provider credentials in logs/metrics
- collecting unnecessary personal seller/user data
- proxy/identity rotation to evade provider controls
- live marketplace calls from normal CI
- production mock substitution
- outbound delivery without verified destination and explicit current consent
- training on data outside approved provider/user scope
- authenticity enforcement from placeholder metadata heuristics
