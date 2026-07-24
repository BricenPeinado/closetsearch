# ClosetSearch Beta Privacy Copy

This is beta privacy copy for a constrained tester launch. It is not a lawyer-approved production privacy policy.

## What ClosetSearch Stores

ClosetSearch currently stores:

- username and password hash for account access
- email identity and verification timestamp when an email is added
- hashes and expiry/consumption metadata for short-lived account-action tokens
- onboarding preferences
- likes
- saved searches
- saved filters
- watchlists
- notification preference shell data
- user settings
- server-side session records

Raw passwords, raw session tokens, and raw account-action tokens are not stored.
Email delivery remains disabled unless an operator configures and injects a
sender.

## Export And Deletion

The account-security foundation supports a one-time, short-lived account export
containing user-owned account and saved-feature data. Credential hashes and
one-time tokens are excluded from that export.

Confirmed account deletion removes the user and records linked to that user by
database foreign keys, including email identity, sessions, likes, searches,
filters, watchlists, alert records, settings, and account-action tokens.
Provider-wide listing observations and price history are retained because they
are marketplace observations rather than user-owned account data.

The API routes and web interface for export and deletion are not active yet.
Expired-token retention cleanup must be scheduled before production activation.

## What ClosetSearch Observes

ClosetSearch also stores normalized listing observations and price snapshots so it can power cautious observed-data analytics.

That observed data can include:

- listing ids
- source marketplace
- brand
- category
- listing title
- observed price and currency
- condition and size when available
- observed timestamps

## What ClosetSearch Does Not Claim

- watchlist delivery is not active yet
- analytics are not financial advice
- analytics are not predictions
- trust or fake-risk UI, when present, is not a definitive authenticity judgment

## Beta Feedback

Feedback from beta testers may be used to improve product behavior, documentation, copy, and stability.

## Current Limits

- provider data may be incomplete, delayed, or stale
- listing availability can change after observation
- some beta environments may use mock or seed data
- account recovery, export, and deletion services are not user-facing until
  their authenticated routes and UI are integrated

If you need production-grade privacy commitments, this repo is not there yet.
