# Release Candidate Checklist

- [ ] frozen install
- [ ] format, lint, typecheck, build
- [ ] unit/contract/integration/Playwright/smoke
- [ ] five consecutive clean full test runs
- [ ] OpenAPI current and validated
- [ ] dependency/image scans
- [ ] PostgreSQL real-engine migration `001`–`006`, concurrency, restart
- [ ] encrypted backup and isolated restore
- [ ] provider authorization matrix current
- [ ] two authorized real providers or explicit no-go/blocker decision
- [ ] production no-mock config and HTTPS staging smoke
- [ ] web/API/worker/migration immutable digests recorded
- [ ] auth/account/saved/entitlement/alert/analytics/session-expiry E2E
- [ ] worker lease/checkpoint/restart and ingestion lag
- [ ] accessibility/mobile/manual checklist
- [ ] ML mode/artifact/version/fallback/concentration reviewed
- [ ] privacy/data-use/retention/legal review
- [ ] metrics/alerts/incident contacts
- [ ] prior images, rollback owner, migration compatibility

Do not seed SQLite demo data as part of production release.
