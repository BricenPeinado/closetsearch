# ClosetSearch Privacy Draft

This is engineering-aligned draft copy, not a lawyer-approved production privacy
policy. Legal review, operator identity/contact, jurisdiction, retention periods,
subprocessors, and user-rights procedures must be completed before public
launch.

## Account data

ClosetSearch can store:

- username and slow password hash
- email identity and verification time
- hashed, purpose-bound account-action tokens plus expiry/use/invalidation state
- hashed session token, expiry/revocation/last-seen state, bounded user agent,
  and one-way IP hint
- onboarding/preferences/settings
- likes, searches, filters, watchlists, notification preferences, alert matches,
  and entitlement state

Raw passwords, raw session tokens, raw account-action tokens, and raw IP hints
are not stored.

## Engagement

The client can report listing views, opens, likes/unlikes, searches, filters,
saves, watchlist creation, recommendation requests/impressions, hides, and
lawfully available outcomes.

- an impression requires at least 50% visibility for one second
- event IDs deduplicate retry
- the opaque privacy-session identifier is hashed
- normalized search text is hashed in engagement events
- authenticated user identity comes from the server session
- properties reject credential/direct-identifier field names and have size/
  count limits

Signed-in recent/saved searches are separately user-owned product records and can
contain the user's query text.

## Marketplace observations

ClosetSearch can retain provider/source listing ID, destination/images, title,
brand/category/size/condition, exact prices/currencies, shipping, seller metadata
when lawfully provided, lifecycle/status, observation times, attribution, and
analytics eligibility. Price/lifecycle history remains after a listing becomes
sold, stale, removed, or unavailable.

Marketplace observations are provider/catalog data, not attributed account data.

## Export

A verified user can request a short-lived one-time export link. Export contains
owned account, identities, non-secret session metadata, likes, searches,
filters, watchlists, preferences, alert matches, and settings. It excludes
password hashes, session/token hashes, and IP-hint hashes.

The API and web export flow are implemented. Delivery remains unavailable until
an approved transactional email provider/sender is configured.

## Deletion

Exact username confirmation deletes the account and cascades identities,
sessions, action tokens, settings, likes, saved state, watchlists, notification
preferences, alerts/deliveries, subscriptions, and entitlements.

Raw engagement events use `ON DELETE SET NULL` for user ownership, so deletion
removes the direct user link while retaining the pseudonymous event/session hash
for aggregate integrity. Marketplace listing/price observations and aggregate
catalog features remain because they are not user-owned.

The API and web deletion flow are implemented. Product/legal review must decide
whether pseudonymous engagement should also be physically erased and document
the final policy before launch.

## Alerts and communications

In-app watchlist matching/inbox is implemented. Outbound email alerts and account
action delivery are disabled without an approved provider. Push and SMS are
disabled.

No preference setting alone means that a message was sent.

## Analytics and ML

- analytics are observed context, not financial advice or predictions
- asking and confirmed sold prices remain distinct
- recommendation and fair-value candidates use versioned offline evaluation
- current model candidates are not promoted
- no production authenticity/fake verdict is provided
- raw sensitive user feature vectors are not returned to clients

## Retention

The schema supports expiry timestamps and repository cleanup boundaries, but
production retention scheduling/periods are not fully approved or evidenced in
this checkout. Before launch, publish and enforce periods for:

- expired/revoked sessions and account tokens
- raw engagement versus daily aggregates
- ingestion idempotency events and worker runs
- alert deliveries/dead letters
- audit/maintenance records
- provider history according to each authorization agreement
- backups and deletion propagation

## Current blockers

- legal review and final policy/contact/rights process
- provider data authorization
- transactional email subprocessor/configuration
- approved retention schedule and deletion verification
- production backup/subprocessor records
