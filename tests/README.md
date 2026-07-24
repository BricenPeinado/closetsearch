# Tests

This folder contains cross-package and browser-level tests. Package-local unit and
integration tests remain next to the code they cover.

`tests/e2e/closetsearch.spec.ts` runs signed-out discovery,
signed-in/onboarding/likes, watchlist create-edit-delete, persisted-entitlement
analytics authorization, provider-degraded, revoked-session recovery, and
account-deletion flows with Playwright.

The default local configuration is hermetic:

- API persistence is an in-memory SQLite database.
- the provider runtime is mock-only with real providers explicitly disabled.
- mock inventory remains visibly labeled in the UI.
- external HTTPS requests are blocked by the browser context.

The PostgreSQL-only account-deletion flow is skipped on that compatibility
path. CI also runs the suite with `PLAYWRIGHT_PERSISTENCE_DRIVER=postgres`
against its PostgreSQL service, which exercises production request persistence
and the deletion/session-invalidation flow. Neither mode calls a live
marketplace.

`tests/e2e/accessibility.spec.ts` uses axe-core to scan signed-out Home/Login and
signed-in Profile/Alerts against WCAG 2 A/AA tags. Automated scans supplement,
not replace, keyboard, screen-reader, zoom, reduced-motion, mobile, and manual
contrast review.

Run it with:

```sh
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

Do not add live marketplace credentials, product data dumps, or marketplace
research notes here.
