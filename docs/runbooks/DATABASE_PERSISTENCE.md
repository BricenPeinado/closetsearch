# Database Persistence

## Overview

ClosetSearch now uses a small SQLite persistence layer in `apps/api` for local product state that should survive API restarts without introducing a full production database stack yet.

This milestone intentionally keeps the scope narrow:

- users
- onboarding preferences
- likes
- recent searches
- saved searches
- normalized listing cache

It does not add production auth, distributed caching, watchlists, billing, or analytics persistence.

## Database Choice

Milestone 14 uses SQLite because the project is still in early productization and benefits from a local, file-backed database that is easy to review and easy to reset.

The API uses Node's built-in `node:sqlite` runtime with `DatabaseSync`.

Current tradeoffs:

- simple local setup
- no separate database server required
- good fit for seeds, tests, and early persistence
- not the final production database plan
- still subject to the current `node:sqlite` experimental warning in Node 24

## Database Path

Environment variable:

- `CLOSETSEARCH_DB_PATH`

Default local path:

- `apps/api/.data/closetsearch.sqlite`

If `CLOSETSEARCH_DB_PATH` is not set, the API creates the `.data` directory automatically when the database is first opened.

## Schema

The initial migration lives at:

- `apps/api/src/db/schema/001_initial_persistence.sql`

Tables added in Milestone 14:

- `users`
- `likes`
- `recent_searches`
- `saved_searches`
- `listing_cache`
- `schema_migrations`

## Commands

Run migrations:

```sh
corepack pnpm db:migrate
```

Run seed data:

```sh
corepack pnpm db:seed
```

API-only equivalents:

```sh
corepack pnpm --filter @closetsearch/api db:migrate
corepack pnpm --filter @closetsearch/api db:seed
```

## Seed Data

The seed script lives at:

- `apps/api/src/db/seed.ts`

Current seed behavior is intentionally small:

- creates a local demo user: `closetdemo`
- adds one recent search
- adds one saved search

This is seed convenience only. It is not a production auth bootstrap.

## Runtime Behavior

The API opens the configured database on startup and runs migrations automatically before request handling.

Persistence boundaries stay inside `apps/api`:

- services call small repository helpers
- repository modules own SQL statements
- provider logic remains outside the database layer
- the web app only talks to normalized API routes

## Test Isolation

API tests should not use the default local database file.

Helpers in `apps/api/src/db/test-helpers.ts` create isolated temporary SQLite files for each test suite.

Current approach:

- each relevant API test suite sets a temporary database path
- the suite resets service tables before each test
- cleanup removes the temporary database directory after each test
- restart/reinitialization tests close and reopen the same file-backed database to verify persistence

## Current Route Additions

Milestone 14 added:

- `GET /recent-searches/:userId`
- `POST /recent-searches`
- `DELETE /recent-searches/:userId`
- `GET /saved-searches/:userId`
- `POST /saved-searches`
- `DELETE /saved-searches`

Signed-out recent searches still fall back to browser `localStorage` in the web app.

## Known Limitations

These are intentionally deferred to Milestone 15 and later:

- production-grade password hashing and auth/session handling
- Postgres or managed production database support
- distributed or cross-process cache invalidation
- watchlists and alerts
- analytics snapshot persistence
- database-backed provider pagination/session state beyond the current listing cache
