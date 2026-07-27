# Documentation

## Production status

- [Implementation report](implementation-report.md)
- [Immutable pre-implementation gap matrix](production-gap-matrix.md)
- [Provider acquisition/compliance matrix](provider-acquisition-matrix.md)
- [Known limitations](known-limitations.md)
- [Truthful roadmap](../TASKS.md)

## Operations

- [Production deployment](runbooks/PRODUCTION_DEPLOYMENT.md)
- [Environment reference](runbooks/environment.md)
- [PostgreSQL persistence](runbooks/DATABASE_PERSISTENCE.md)
- [Backup and restore](runbooks/POSTGRES_BACKUP_RESTORE.md)
- [Production rollback](runbooks/PRODUCTION_ROLLBACK.md)
- [Incident response](runbooks/INCIDENT_RESPONSE.md)
- [Deployment checklist](runbooks/deployment-checklist.md)
- [Provider operations/compliance](runbooks/PROVIDERS.md)
- [Provider configuration](runbooks/PROVIDER_CONFIGURATION.md)
- [Pagination/caching](runbooks/PAGINATION_AND_CACHING.md)

## Marketplace integration notes

- [Grailed](marketplace-notes/GRAILED.md)
- [Depop](marketplace-notes/DEPOP.md)
- [Yahoo! Auctions Japan](marketplace-notes/YAHOO_AUCTIONS_JP.md)
- [Mercari Japan](marketplace-notes/MERCARI_JP.md)

eBay uses the official API path documented in the provider operations and
configuration runbooks.

## Product systems

- [Authentication/account security](runbooks/auth.md)
- [Saved user features](runbooks/user-features.md)
- [Alerts/watchlists](runbooks/alerts-watchlists.md)
- [Market analytics](runbooks/analytics.md)
- [Personalization/ML runtime](runbooks/personalization.md)
- [ML dataset/model cards and evaluation](ml/README.md)

## QA and release

- [Current QA baseline](runbooks/QA_BASELINE.md)
- [Manual beta checklist](qa/manual-beta-checklist.md)
- [Release candidate checklist](release/release-candidate-checklist.md)
- [Go/no-go](release/go-no-go.md)
- [Launch blockers](release/launch-blockers.md)
- [Post-launch monitoring](release/post-launch-monitoring.md)
- [Release notes template](release/release-notes-template.md)

The older beta feedback, triage, privacy, and release notes remain historical
planning inputs. When an older document conflicts with a production-hardening
runbook, the current runbook, provider matrix, `TASKS.md`, and implementation
report are authoritative.
