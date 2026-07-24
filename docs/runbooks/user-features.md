# Saved User Features

## Production persistence

In PostgreSQL production mode, session-scoped repositories persist:

- likes that reference server-persisted normalized catalog listings
- recent and saved searches
- saved filter presets
- watchlists
- notification preferences
- display/currency/source/sort settings

SQLite provides equivalent local/test compatibility. The client never chooses a
user ID; every operation uses the authenticated session.

## Routes

- `/likes` and `/me/likes`
- `/recent-searches`
- `/saved-searches` and `/me/saved-searches`
- `/me/saved-filters`
- `/me/watchlists` and `/me/watchlists/:id`
- `/me/notification-preferences`
- `/me/settings`
- `/me/alerts`
- `/me/alerts/seen`
- `/me/alerts/dismiss`

Legacy route aliases remain where required by the web contract, but PostgreSQL
production routing enforces the same ownership checks.

## Likes

PostgreSQL feed/search persist sanitized provider-normalized listings before
returning them. A production like supplies only the displayed listing identity
and source; the API requires the corresponding server-owned catalog row and
reconstructs the response from it. Browser listing content cannot create or
rewrite catalog status, asking/sold price, or history. An unknown identity is
rejected instead of being trusted.

The user/listing unique key makes retries idempotent. Unlike removes only the
current user's relation.

Likes feed both profile rendering and personalization features.

## Searches and filters

Saved searches preserve normalized search parameters and labels. Saved filters
preserve reusable query/source/listing-type/market/price/sort intent. Normalized
uniqueness prevents accidental duplicates and newest entries sort first.

Recent search storage is durable for signed-in users; signed-out recent state may
remain browser-local.

## Settings and currency

Settings include display name, preferred currency, preferred sources, and
default sort. Preferred currency is a request for display conversion, not
permission to relabel money. If the exchange service has no valid quote, the UI
keeps the original currency.

## Watchlists and alerts

Watchlists support query, canonical/provider brand, category, source, listing
type, market status, price/currency, size, condition, label, frequency, and
enabled state. Worker ingestion matches new/changed durable listings.

In-app alerts are active. Email, push, and SMS preferences cannot be enabled:
the API returns `delivery_channel_unavailable` until real providers exist.
See [Alerts and watchlists](alerts-watchlists.md).

## Verification

Tests cover:

- restart persistence
- user ownership and spoofed-ID rejection
- deduplication and deletion
- server-owned catalog enforcement and forged listing-snapshot rejection
- search/filter/watchlist validation
- currency/settings behavior
- in-app alert inbox state
- PostgreSQL production request paths

Account export and deletion include/cascade these user-owned records as described
in [Authentication and account security](auth.md).
