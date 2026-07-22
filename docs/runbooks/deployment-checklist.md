# Deployment Checklist

This checklist prepares ClosetSearch for a constrained beta launch, not a full public production rollout.

## Runtime Baseline

- Node: `v24.5.0` recommended for parity with the current local beta setup
- pnpm: `10.0.0`
- Package manager command prefix: `corepack pnpm`

## Pre-Deploy Commands

Run these from the repo root:

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm build
corepack pnpm lint
corepack pnpm test
corepack pnpm db:migrate
corepack pnpm db:seed
```

## Build and Start Commands

- API build: `corepack pnpm --filter @closetsearch/api build`
- API start: `corepack pnpm --filter @closetsearch/api start`
- Web build: `corepack pnpm --filter @closetsearch/web build`
- Combined workspace build: `corepack pnpm build`

## Required Environment Variables

For a safe beta deployment, set:

- `HOST`
- `PORT`
- `CLOSETSEARCH_DB_PATH`
- `AUTH_ALLOWED_ORIGINS`
- `AUTH_SESSION_COOKIE_NAME`
- `AUTH_SESSION_TTL_DAYS`
- `AUTH_COOKIE_SECURE`
- `VITE_API_BASE_URL`

At least one auth token pepper should also be configured for beta:

- `AUTH_SESSION_PEPPER`

## Optional Environment Variables

Provider and runtime tuning variables are optional:

- `PROVIDER_RUNTIME_MODE`
- `PROVIDER_ALLOW_MOCK_FALLBACK`
- `PROVIDER_REQUEST_TIMEOUT_MS`
- `PROVIDER_MAX_ACTIVE_PROVIDERS`
- `PROVIDER_MOCK_ENABLED`
- `GRAILED_PROVIDER_ENABLED`
- `GRAILED_SCRAPING_ALLOWED`
- `GRAILED_BASE_URL`
- `GRAILED_REQUEST_TIMEOUT_MS`
- `GRAILED_MIN_REQUEST_INTERVAL_MS`
- `GRAILED_MAX_RESULTS_PER_SEARCH`
- `GRAILED_USER_AGENT`

## Provider Configuration Notes

- `mock` mode is still the safest beta fallback.
- Do not enable `GRAILED_SCRAPING_ALLOWED=true` unless written approval still exists and matches the current request profile.
- `GET /providers/health` is useful for smoke checks because it exposes safe provider status only.

## Auth and Session Cookie Notes

- Cookies are `HttpOnly`, `SameSite=Lax`, and `Path=/`.
- `AUTH_COOKIE_SECURE=true` should be used for HTTPS beta deployments.
- `AUTH_ALLOWED_ORIGINS` must exactly match the deployed web origins for credentialed requests.
- Changing `AUTH_SESSION_PEPPER` invalidates existing sessions.

## Database Notes

- The API uses SQLite through `CLOSETSEARCH_DB_PATH`.
- Make sure the deployment target can create and write the parent directory.
- Run migrations before starting the API on a fresh environment.
- `corepack pnpm db:seed` adds demo-safe data for the `closetdemo` account and mock analytics observations without touching unrelated user data.

## Web Build and Deploy Notes

- The web app is a static Vite build.
- `VITE_API_BASE_URL` must point at the deployed API origin.
- Keep web and API origins aligned with `AUTH_ALLOWED_ORIGINS` so cookie-backed auth works.

## Local vs Beta Differences

- Local development typically uses `AUTH_COOKIE_SECURE=false`; HTTPS beta should use `true`.
- Local and demo environments may rely on mock provider data more often than beta.
- Analytics sample data and demo seeds can make the app look healthier than a fresh, unseeded environment.
- `GET /providers/health` is development-oriented and currently unauthenticated.

## Smoke Test After Deploy

1. Open the web app and confirm the shell loads.
2. Verify `GET /health` returns `200`, `service`, `status`, and a timestamp.
3. Verify `GET /providers/health` returns safe provider metadata without secrets.
4. Run `corepack pnpm smoke:test` against the deployed API if direct CLI access is available.
5. Sign up or log in and confirm cookie-backed auth works.
6. Open feed, search, brands, analytics, and profile.
7. Save a like, search, filter, and watchlist.
8. Confirm watchlist UI still says delivery is not active.
9. Confirm analytics still says observed-data only and not financial advice.
10. Confirm `closetdemo` seed data appears if the seed command was run.

## Rollback Notes

- Keep the previous API build artifact and previous web build artifact available for quick restore.
- Back up the SQLite file before risky beta migrations or seed changes.
- If a beta deploy breaks auth or persistence, roll back the app build and restore the last known-good database copy if needed.
- If only the seed or demo data is wrong, do not wipe real user data blindly; prefer restoring from backup or reseeding only the demo environment.
