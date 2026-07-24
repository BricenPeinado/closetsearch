# Web App

`@closetsearch/web` is the React/Vite product.

It implements feed, search, brands, auth/onboarding/profile, likes, saved
features, watchlists, an in-app alert inbox, and observed analytics. Account
security screens support setting an email, requesting verification/reset/export,
consuming one-time verification/reset/export links, downloading an export, and
confirmed account deletion. Outbound action-link delivery still requires an
approved email provider. Worker-generated inbox data requires PostgreSQL;
SQLite compatibility does not run watchlist matching.

Listing cards show normalized provenance, exact original/display money when
conversion exists, lifecycle/freshness, optional seller/shipping metadata,
accessible like state, lazy images, and a local failure fallback.

Feed/search support URL-persisted filters, duplicate prevention,
IntersectionObserver loading, an accessible Load More fallback, scroll
restoration, and explicit empty/retry/partial/stale/session-expired states.

The client emits privacy-conscious engagement events. An impression is emitted
only after a listing is at least 50% visible for one second; a server response
does not count as an impression.

```sh
corepack pnpm --filter @closetsearch/web dev
corepack pnpm --filter @closetsearch/web test
corepack pnpm --filter @closetsearch/web build
```

`VITE_API_BASE_URL` is embedded at build time. The web app contains no
marketplace or database credentials.
