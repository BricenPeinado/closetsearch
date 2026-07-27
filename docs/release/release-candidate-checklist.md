# Release Candidate Checklist

- [ ] frozen install
- [ ] format, lint, typecheck, build
- [ ] unit/contract/integration/Playwright/smoke
- [ ] five consecutive clean full test runs
- [ ] OpenAPI current and validated
- [ ] dependency/image scans in an approved environment (local dependency audit
      is blocked by the managed outbound-metadata policy)
- [ ] PostgreSQL real-engine migration `001`–`007`, prior-schema upgrade,
      concurrency, restart, listing detail, price trends, and alert delivery
- [ ] encrypted backup and isolated restore
- [ ] provider authorization matrix current
- [ ] authorization references and activation evidence for every claimed one of
      eBay, Grailed, Depop, Yahoo! Auctions Japan, and Mercari Japan
- [ ] production no-mock config and HTTPS staging smoke
- [ ] web/API/worker/migration immutable digests recorded
- [ ] auth/account/saved/entitlement/alert/analytics/session-expiry E2E
- [ ] listing detail/share URL and price-trend currency/evidence/filter E2E
- [ ] expanded Playwright critical journeys run on final SHA: saved search/
      recommendation/like, login/logout/reset, notification settings to exact
      alert listing, export/deletion, responsive filters, and Japanese
      auction/detail/trends
- [ ] enabled email/SMS transports have verified sender/destination, explicit
      current consent, per-watchlist enablement, signed webhook/replay,
      unsubscribe/STOP, suppression/retry, and privacy evidence
- [ ] final account export includes the approved non-secret phone identity and
      consent/suppression representation, with deletion/retention behavior
      documented and tested
- [ ] worker lease/checkpoint/restart and ingestion lag
- [ ] accessibility/mobile/manual checklist
- [ ] ML mode/artifact/version/fallback/concentration reviewed
- [ ] privacy/data-use/retention/legal review
- [ ] metrics/alerts/incident contacts
- [ ] secret-managed operations bearer token and authenticated health/metrics
      probes
- [ ] Sites `CLOSETSEARCH_API_ORIGIN` points to the intended HTTPS API and the
      same-origin edge route does not return `503`
- [ ] generated 1200×630 Open Graph/Twitter card resolves over deployed HTTPS;
      alt/copy/crop/readability and target link-unfurler previews retained
- [ ] prior images, rollback owner, migration compatibility

Do not seed SQLite demo data as part of production release.
Do not carry the historical `3072b33` test record forward as evidence for the
current five-provider/migration `007` working tree.
