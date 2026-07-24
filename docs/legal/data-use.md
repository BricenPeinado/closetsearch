# ClosetSearch Data-Use Draft

This is operational engineering guidance, not approved legal terms.

## Permitted product use

User-owned data supports sessions, account recovery/export/deletion, saved
features, in-app watchlist alerts, entitlement authorization, and explainable
personalization.

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

## Account rights

The implemented one-time export excludes credential/token hashes. Confirmed
deletion cascades user-owned state and removes the user association from raw
engagement while retaining pseudonymous events/aggregates and provider-wide
catalog history. Final legal policy and retention/deletion enforcement still
require approval.

## Alerts and billing

In-app alerts are active. Email account actions/alerts require an approved sender
and verified address; push/SMS are disabled. No billing provider is configured,
and a development entitlement must not be described as a subscription.

## Prohibited uses

- credential/session/token logging
- collecting unnecessary personal seller/user data
- proxy/identity rotation to evade provider controls
- live marketplace calls from normal CI
- production mock substitution
- training on data outside approved provider/user scope
- authenticity enforcement from placeholder metadata heuristics
