# Release Notes Template

## Identity

- version/commit:
- API/worker/web image digests:
- date/operator:

## Implemented

- discovery/providers:
- PostgreSQL/schema:
- worker/ingestion:
- accounts/saved state:
- engagement/recommendations:
- analytics:
- entitlements/alerts:
- security/operations:

## Provider/compliance

- authorized active providers:
- authorization references/expiry:
- mock provider/fallback state:
- known capability/degradation:

## Schema

- prior/current version:
- migration names/checksums:
- backup/restore evidence:

## ML

- rollout mode/artifact/model/feature versions:
- evaluation/promotion decision:
- active fallback:

## Quality evidence

- required command run:
- five-run evidence:
- PostgreSQL/restore:
- Playwright/staging smoke:

## External blockers/deferred

- provider:
- email/billing/FX:
- ML data:
- push/SMS/authenticity:

## Deployment/rollback

- rollout sequence:
- observation window:
- prior image digests:
- rollback owner/deadline:

Never describe fixtures as live, development entitlements as billing, in-app
alerts as outbound delivery, or synthetic ML metrics as production performance.
