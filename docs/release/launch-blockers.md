# Launch Blockers

This file tracks launch-candidate blockers only. It is not a backlog for every product idea or polish item.

## Current Status

No open `P0` or `P1` launch blockers are currently required to be fixed before cutting the constrained preview release candidate described in this milestone.

## Resolved in the Launch-Candidate Pass

| Blocker | Severity | Status | Owner / File Area | Fix Reference | Release Decision |
| --- | --- | --- | --- | --- | --- |
| Built API artifact could not start because shared package ESM exports and schema assets were packaged incorrectly | P0 | Resolved | `packages/shared/src/*`, `packages/providers/src/*`, `apps/api/package.json` | Milestone 22 RC hardening | Included in RC |
| Root smoke-test command pointed at a missing script | P1 | Resolved | `package.json`, `scripts/smoke-test.mjs`, `scripts/beta-smoke-test.mjs` | Milestone 22 RC hardening | Included in RC |
| Partial provider failures surfaced poorly to users | P1 | Resolved | `apps/web/src/app.tsx`, `apps/api/src/feed-service.ts`, `apps/api/src/search-service.ts` | Milestone 21 hardening + RC verification | Included in RC |
| Malformed provider listing could risk unstable results | P1 | Resolved | `apps/api/src/providers/listing-sanitizer.ts`, `apps/api/src/providers/orchestrator.ts` | Milestone 21 hardening | Included in RC |
| Session expiry recovery could leave users confused | P1 | Resolved | `apps/web/src/app.tsx`, `apps/web/src/api-client.ts` | Milestone 21 hardening | Included in RC |

## Deferred but Accepted for This RC

| Blocker | Severity | Status | Owner / File Area | Deferred Reason | Release Decision |
| --- | --- | --- | --- | --- | --- |
| Limited provider coverage beyond current runtime modes | Later | Deferred | `apps/api/src/providers/*`, `packages/providers/*` | Outside RC scope and not a crash blocker for constrained preview | Accepted risk |
| Full account recovery flows | Later | Deferred | `apps/api/src/auth/*`, `apps/web/src/app.tsx` | Important before broader public launch, but not new RC scope | Accepted risk |
| Production-grade observability and automation | Later | Deferred | `docs/runbooks/*`, ops tooling | Outside current stack maturity and not required to cut a constrained preview RC | Accepted risk |
