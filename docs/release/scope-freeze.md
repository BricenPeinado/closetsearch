# Production-Hardening Scope Freeze

## In scope

- authorized provider adapters and fail-closed production behavior
- normalized exact listing/money/lifecycle data and discovery UX
- PostgreSQL production request/data plane and resumable worker ingestion
- deterministic price history and observed analytics
- normalized listing detail and typed price-trend intelligence
- durable qualified engagement and guarded recommendation runtime
- persisted entitlements, in-app watchlist alerts, and fail-closed opt-in
  Resend/Twilio delivery foundations
- secure account verification/reset/export/deletion foundations
- API security/OpenAPI, tests, containers, CI, metrics, backup/restore, deploy/
  rollback docs

## External activation blockers

- eBay approval/credentials
- durable authorization references for the operator-attested Grailed, Depop,
  Yahoo! Auctions Japan, and Mercari Japan permissions
- production Resend/Twilio accounts, verified senders, credentials, public
  callback origins, explicit user consent, and staging evidence
- billing and live FX providers
- Sites-to-API origin and production operations bearer configuration
- adequate production ML data
- authorized HTTPS staging environment

## Intentionally excluded

- push
- OAuth/social login
- production authenticity/fake verdicts
- active unpromoted ML
- seller posting/social tools

## Release rule

Internal implementation can be complete while public production remains no-go.
External blockers must be reported, not replaced with fixtures or placeholder
claims. Final release requires all quality/operational evidence in
[go/no-go](go-no-go.md).
