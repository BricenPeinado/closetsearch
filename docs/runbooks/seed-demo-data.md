# Seed and Demo Data

## Scope

The current seed command targets the SQLite local/test compatibility database.
It is for demos and QA, not production bootstrap, billing, provider ingestion,
or PostgreSQL production state.

```sh
corepack pnpm db:migrate:sqlite
corepack pnpm db:seed:sqlite
```

It creates/updates a fixed `closetdemo` account and representative onboarding,
search/filter/watchlist/settings, and mock observed-listing data. Seed behavior
is idempotent for its fixed keys and does not intentionally delete unrelated
records.

## Safety

- never run demo credentials/data in public production
- never describe seeded fixtures as marketplace inventory
- never use the demo account as premium authorization
- do not use the SQLite seed command against PostgreSQL
- destructive reset is a separate, explicit operation

Production catalog data must come from authorized worker ingestion. Production
entitlements require the persisted entitlement service, and a development grant
is non-production-only, disabled by default, and requires a verified admin
identity.
