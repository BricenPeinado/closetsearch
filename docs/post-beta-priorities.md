# Remaining Priorities

## Public-launch blockers

1. Obtain and retain authorized live provider access. The target is two real
   providers; eBay and Grailed are both externally blocked.
2. Run a no-mock HTTPS staging smoke with those providers.
3. Configure transactional email and exercise verification/reset/export.
4. Add a Compose boot and encrypted off-host backup/restore drill to the
   completed local PostgreSQL concurrency/lease/restart/checksummed-restore
   evidence.
5. Approve privacy, retention, subprocessor, and incident processes.
6. Configure dashboards/alerts, secret rotation, error tracking, and HA/PITR.

## Production follow-through

- distributed auth/account rate limiting
- approved exchange-rate provider and persisted refresh schedule
- outbound email alert handler with bounce/suppression/retry operations
- billing provider with signed idempotent webhooks
- broader Playwright coverage against PostgreSQL staging
- query-plan and capacity review with representative data volume

## Data and ML

- collect deletion-aware temporal engagement snapshots
- obtain enough confirmed sold outcomes under provider terms
- evaluate recommendation segments, diversity, novelty, provider/brand
  concentration, and latency
- improve/calibrate fair-value candidate until it beats observed baseline
- keep rules and observed ranges active until promotion gates pass

## Intentionally deferred

- push and SMS
- authenticity/fake verdicts
- OAuth/social login and device management UI
- seller posting/social tools

## Ongoing risks

- upstream provider contract/permission changes
- sparse/biased sold coverage
- analytics overinterpretation
- exposure bias in engagement-trained models
- multi-replica cache/rate/database concurrency budgets
