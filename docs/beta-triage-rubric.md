# Beta Triage Rubric

Use this rubric to turn beta feedback into actionable work without widening scope prematurely.

## Severity Levels

- `P0`: blocks app usage, data loss, auth failure, or broken deploy
- `P1`: blocks a core beta flow for many testers
- `P2`: confusing or broken secondary feature
- `P3`: polish, copy, layout, or other nice-to-have fix
- `Later`: real feature expansion beyond current beta scope

## Categories

- auth/session
- feed/search
- providers/data quality
- saved user features
- personalization
- analytics
- watchlists
- mobile/responsive
- docs/setup
- privacy/trust copy
- performance
- unknown/needs reproduction

## Triage Process

1. Reproduce the issue or mark it `needs reproduction`.
2. Assign a severity based on user impact, repeatability, and whether testing can continue.
3. Identify the likely owner or file area.
4. Decide whether to fix now, defer to post-beta, or document as a known limitation.
5. Write a short resolution note with the outcome and next action.
6. Update [known limitations](./known-limitations.md) if the issue is real but not being fixed now.

## Owner and File Hints

- auth/session: `apps/api/src/auth/*`, `apps/web/src/user-session.ts`, `apps/web/src/app.tsx`
- feed/search: `apps/api/src/feed-service.ts`, `apps/api/src/search-service.ts`, `apps/web/src/app.tsx`
- providers/data quality: `apps/api/src/providers/*`, `packages/providers/*`
- saved user features: `apps/api/src/*-service.ts`, `apps/web/src/app.tsx`
- analytics: `apps/api/src/services/analyticsService.ts`, `apps/web/src/app.tsx`
- watchlists: `apps/api/src/services/watchlistService.ts`, `apps/api/src/services/alertPreferenceService.ts`, `apps/web/src/app.tsx`
- docs/setup: `README.md`, `docs/**/*`

## Fix-Now Guidance

- Fix now when the issue is `P0` or `P1`, or when it meaningfully improves trust and recovery in a core beta flow.
- Defer when the request adds major new scope, new infrastructure, or feature breadth that does not unblock beta learning.
- Prefer the smallest honest fix that improves stability or clarity.
