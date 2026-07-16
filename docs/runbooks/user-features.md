# User Features Runbook

This runbook covers the saved-user surface added in Milestone 16.

## Scope

Milestone 16 adds persisted user data and account UI for:

- saved likes
- saved searches
- saved filters / search presets
- watchlist shell entries
- basic user settings

It does not add:

- alert delivery
- email or push notifications
- background jobs
- personalization V2 behavior
- analytics V1 behavior
- auth rebuild work

## Auth Boundary

All saved-user API routes use the authenticated session from the production-auth foundation.

Protected routes:

- `GET /me/likes`
- `POST /me/likes`
- `DELETE /me/likes`
- `GET /me/saved-searches`
- `POST /me/saved-searches`
- `DELETE /me/saved-searches`
- `GET /me/saved-filters`
- `POST /me/saved-filters`
- `DELETE /me/saved-filters`
- `GET /me/watchlists`
- `POST /me/watchlists`
- `DELETE /me/watchlists`
- `GET /me/settings`
- `PATCH /me/settings`

The API should ignore spoofed `userId` values from request bodies and always use the authenticated session user.

## Saved Likes

Liked listings now persist in SQLite instead of only living in memory.

Behavior:

- duplicate likes dedupe by `user_id + listing_id`
- likes can store a listing snapshot for later rendering
- if a cached full listing exists, `GET /me/likes` returns it
- if only a snapshot exists, the snapshot is used
- if neither exists, the API returns a safe fallback listing shape instead of crashing

## Saved Searches

Saved searches store:

- label
- description
- serialized search params
- user id
- created timestamp

Behavior:

- dedupe by `user_id + params`
- newest saved search appears first
- saved searches can be reopened from Profile back into `/search?...`

## Saved Filters

Saved filters store lightweight reusable search presets:

- label
- optional query text
- source filter
- listing type filter
- min / max price
- sort mode
- created / updated timestamps

Behavior:

- dedupe by `user_id + normalized filter params`
- filter-only searches are valid and can reopen the search page without a text query

## Watchlist Shell

Watchlists are stored user intent only.

Stored fields:

- label
- query text
- optional brand
- optional max price
- optional source
- created / updated timestamps

Important boundary:

- watchlists do not trigger alerts yet
- there are no jobs, notifications, emails, or pushes yet
- UI copy should keep saying alert delivery comes later

## User Settings

Current settings include:

- preferred currency
- optional default sort mode
- optional preferred sources
- optional display name

Currency is display-preference scaffolding only for now. Listing prices remain marketplace-native until conversion is implemented.

## Database Notes

Milestone 16 adds migration `003_saved_user_features.sql` with:

- liked listing snapshot storage on `likes`
- `saved_filters`
- `watchlists`
- `user_settings`
- saved-search timestamp support for future updates

## Frontend Notes

The profile route is now the main signed-in account surface.

Users can:

- view and unlike liked listings
- reopen and delete saved searches
- apply and delete saved filters
- create and delete watchlist shell entries
- update basic settings

The search route adds:

- `Save search` for signed-in users with an active query or filter
- `Save filters` for signed-in users with active filters
- signed-out prompts that route users to login instead of failing silently

## Deferred Work

The following remains intentionally deferred to Milestones 17-19:

- personalization V2 using richer saved-user behavior
- watchlist alert delivery
- notifications
- analytics V1
- broader account-management features beyond the current settings/profile surface
