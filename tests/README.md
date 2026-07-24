# Tests

This folder contains cross-package and browser-level tests. Package-local unit and
integration tests remain next to the code they cover.

`tests/e2e/closetsearch.spec.ts` runs the signed-out, signed-in/onboarding,
provider-degraded, and revoked-session recovery flows with Playwright. Its server
configuration is hermetic:

- API persistence is an in-memory SQLite database.
- the provider runtime is mock-only with real providers explicitly disabled.
- mock inventory remains visibly labeled in the UI.
- external HTTPS requests are blocked by the browser context.

Run it with:

```sh
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

Do not add live marketplace credentials, product data dumps, or marketplace research
notes here.
