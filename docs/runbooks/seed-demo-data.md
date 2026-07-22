# Seed and Demo Data

## Purpose

ClosetSearch ships with a lightweight seed path so constrained beta environments can demonstrate core flows even when real provider coverage is limited.

## Command

Run from the repo root:

```sh
corepack pnpm db:seed
```

This delegates to:

```sh
corepack pnpm --filter @closetsearch/api db:seed
```

## What the Seed Adds

The current seed command adds beta-safe demo data only:

- demo user: `closetdemo`
- demo password: `closetdemo`
- onboarding preferences
- recent search
- saved search
- saved filter
- watchlist
- notification preference shell
- user settings
- mock observed listings for analytics sample behavior

No real user personal data or real secrets are seeded.

## Idempotency

The seed command is designed to be rerun safely:

- it targets fixed demo ids or unique keys
- it updates the seed account and related demo records instead of duplicating them
- it does not delete unrelated users or wipe real beta data

## Demo vs Real Data

- demo account data is clearly seed-only
- observed analytics seeded today come from mock listings
- real provider data, when available, can still coexist beside the demo seed
- beta docs and in-app copy should continue to explain what is mock, observed, or deferred

## Recommended Beta Usage

- run the seed command for local demos, QA environments, and constrained beta previews
- do not rely on the demo account as a substitute for testing signup, login, or real saved-user persistence
- if a beta environment should start clean, skip the seed or reset only the demo environment intentionally

## Suggested Demo Flows

After seeding:

1. Log in as `closetdemo`.
2. Open Profile and verify saved search, saved filter, watchlist, and settings data.
3. Open Analytics and verify observed-data sections have sample content.
4. Verify watchlist copy still says delivery is not active.

## Safety Notes

- do not seed into an environment where demo credentials would confuse real end users without labeling
- do not replace or delete real user data as part of a normal seed run
- if you need a destructive reset, handle that as a separate explicit maintenance step
