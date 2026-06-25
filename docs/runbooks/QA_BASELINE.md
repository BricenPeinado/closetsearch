# QA Baseline

## Scope

Milestone 10 focused on stabilization, route verification, QA coverage, copy cleanup, and honest documentation. This pass did not add a real provider, persistence, production auth, payments, advanced analytics, or authenticity logic.

## Commands Run

- `corepack pnpm typecheck` - passed
- `corepack pnpm lint` - failed initially because of an unused `brandDirectoryLink` constant in `apps/web/src/app.tsx`; passed after cleanup
- `corepack pnpm test` - passed
- `corepack pnpm build` - passed
- `corepack pnpm install` - not needed in this pass because workspace dependencies were already present locally

## Route Checklist

Routes were verified through the web route smoke tests in `apps/web/src/app.test.tsx`, supporting API tests in `apps/api/src/app.test.ts`, and manual inspection of the current route table in `apps/web/src/app.tsx`.

- [x] `/` home/feed
- [x] `/search`
- [x] `/recent-searches`
- [x] `/brands`
- [x] `/brands/:slug`
- [x] `/signup`
- [x] `/login`
- [x] `/onboarding`
- [x] `/profile`
- [x] `/analytics`
- [x] `*` not-found fallback

## Flow Checklist

This repo does not have browser E2E automation yet, so the current flow baseline was verified through route smoke tests, API tests, component tests, and manual code inspection instead of a click-through browser harness.

- [x] Feed browsing and load-more baseline
- [x] Search and filters
- [x] Recent searches
- [x] Brand browsing and brand detail handoff
- [x] Signup, login, onboarding, and profile baseline
- [x] Likes/hearts and simple personalization hooks
- [x] Analytics placeholder locked/unlocked states
- [x] Trust/risk placeholder UI

## Issues Found In This Pass

- Workspace lint was failing because `brandDirectoryLink` was defined but unused in `apps/web/src/app.tsx`.
- The API fallback 404 message still referenced an old milestone instead of a generic product-facing error.
- The locked analytics UI still leaned on "coming soon" style scaffold copy instead of more honest preview/sample wording.

## Fixes Applied

- Removed the unused `brandDirectoryLink` constant so lint passes cleanly.
- Replaced the stale milestone-specific API 404 message with a generic "Route not found." response.
- Cleaned up locked analytics copy to describe preview-only access and sample pricing context more honestly.
- Added explicit route smoke coverage for the not-found web route.
- Added an API test for unknown route 404 behavior.

## Mock And Placeholder Systems

- Feed and search still run entirely through the mock provider in `packages/providers`.
- Auth is a lightweight local foundation backed by in-memory API state and browser-local session storage.
- Likes, onboarding preferences, and personalization inputs are foundation behavior only and do not survive an API restart.
- Premium analytics access is still a mock preview model driven by reserved usernames.
- Analytics data is sample data only.
- Trust/risk signals are placeholder heuristics with assistive disclaimers, not authenticity detection.

## Known Limitations

- No real provider runtime, secrets handling, rate-limit strategy, or provider failover exists yet.
- No database persistence exists for users, likes, onboarding preferences, or recent searches.
- Sessions live in browser localStorage and there is no production auth/session lifecycle.
- Recent searches are browser-local only.
- Analytics and premium access are preview-only and should not be treated as production features.
- Trust/risk signals are deterministic placeholders and should not be used for enforcement, filtering, or authenticity claims.
- There is still no browser E2E harness, so route verification is smoke-test level rather than full interaction coverage.

## Fragile Areas Before Beta

- Personalization depends on in-memory likes and onboarding data, so behavior resets with API restarts.
- Feed and search pagination behavior is only validated against the mock provider path.
- API and web assumptions around `http://localhost:4000` remain lightweight development defaults.
- Premium preview gating is username-based and not suitable for real entitlement checks.
- Trust/risk heuristics use hardcoded thresholds that are useful for UI plumbing only.

## Recommended Next Milestone

Proceed to **Milestone 11: Real Data Provider Foundation**.

Recommended next-pass priorities:

- add provider runtime configuration and enable/disable flags
- isolate mock vs. real provider selection behind explicit API configuration
- add provider failure handling, timeout behavior, and fallback rules
- document provider environment requirements and test expectations
