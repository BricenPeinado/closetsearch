# Production-Hardening Scope Freeze

## In scope

- authorized provider adapters and fail-closed production behavior
- normalized exact listing/money/lifecycle data and discovery UX
- PostgreSQL production request/data plane and resumable worker ingestion
- deterministic price history and observed analytics
- durable qualified engagement and guarded recommendation runtime
- persisted entitlements and in-app watchlist alerts
- secure account verification/reset/export/deletion foundations
- API security/OpenAPI, tests, containers, CI, metrics, backup/restore, deploy/
  rollback docs

## External activation blockers

- eBay approval/credentials
- Grailed written authorization
- second independent live provider
- transactional email, billing, and live FX providers
- adequate production ML data
- authorized HTTPS staging environment

## Intentionally excluded

- push/SMS
- OAuth/social login
- production authenticity/fake verdicts
- active unpromoted ML
- seller posting/social tools

## Release rule

Internal implementation can be complete while public production remains no-go.
External blockers must be reported, not replaced with fixtures or placeholder
claims. Final release requires all quality/operational evidence in
[go/no-go](go-no-go.md).
