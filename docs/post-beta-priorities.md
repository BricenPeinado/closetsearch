# Remaining Priorities

## Public-launch blockers

1. Configure the retained provider-specific authorization references for the
   four operator-authorized collection integrations and approved production
   eBay credentials/agreements.
2. Run a no-mock HTTPS staging smoke with all five target providers.
3. Configure Resend/Twilio and exercise verification, reset, export,
   notification opt-in, delivery callbacks, unsubscribe, and STOP.
4. Add a Compose boot and encrypted off-host backup/restore drill to the
   completed local PostgreSQL concurrency/lease/restart/checksummed-restore
   evidence.
5. Approve privacy, retention, subprocessor, and incident processes.
6. Configure dashboards/alerts, secret rotation, error tracking, and HA/PITR.

## Production follow-through

- distributed auth/account rate limiting
- approved exchange-rate provider and persisted refresh schedule
- production Resend/Twilio sender and callback configuration plus delivery
  reconciliation evidence
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

- push
- authenticity/fake verdicts
- OAuth/social login and device management UI
- seller posting/social tools

## Ongoing risks

- upstream provider contract/permission changes
- sparse/biased sold coverage
- analytics overinterpretation
- exposure bias in engagement-trained models
- multi-replica cache/rate/database concurrency budgets
