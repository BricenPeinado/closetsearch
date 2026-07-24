# Product

## Product promise

ClosetSearch helps shoppers discover normalized fashion-resale listings across
marketplaces without pretending that incomplete marketplace data, asking prices,
or experimental models are more certain than they are.

Core workflows are:

- browse a visual, personalized feed
- search by text, brand, category, size, condition, source, listing type,
  market status, price, currency, and sort
- inspect marketplace, status, freshness, seller, shipping, original price, and
  converted display price when those fields are actually supported
- save listings, searches, filters, and watchlists
- receive durable in-app watchlist matches
- view entitlement-gated, observed comparable-price context

## Product principles

- **Real provenance:** mock fixtures are always identified as mock.
- **Fail closed:** production does not substitute fixtures when a provider is
  unavailable or unauthorized.
- **Provider neutrality:** raw provider shapes remain inside adapters.
- **Exact money:** cross-currency comparison requires a rate and provenance;
  unconverted money keeps its original currency.
- **Partial results over false certainty:** one provider can degrade without
  destroying valid results from another.
- **Responsible intelligence:** rules and observed ranges remain available when
  an ML artifact, data, latency, or confidence gate fails.
- **Privacy-conscious engagement:** durable events use opaque identifiers and
  describe actions the client actually observed.
- **No authenticity overclaim:** metadata-quality assistance is not an
  authentic/fake verdict.

## Implemented product behavior

### Discovery

Feed and search support deterministic per-provider pagination, duplicate
prevention, URL-persisted filters, IntersectionObserver loading with an
accessible Load More fallback, scroll restoration, partial/degraded states, and
responsive listing cards. Cards reserve image aspect ratio, have a local error
fallback, expose accessible like state, and show optional normalized metadata
only when supported.

### Accounts and saved features

Production request state is PostgreSQL-backed. Signup/login sessions, onboarding,
likes, recent/saved searches, filters, watchlists, notification preferences, and
settings survive process restarts. Email verification, password reset, account
export, and account deletion have hashed, purpose-bound, one-time-token API
and web flows. Browser action links keep tokens in a fragment and scrub it after
reading. Transactional email is disabled until a provider is configured, so
link delivery is externally/configuration blocked.

### Engagement and recommendations

The web client reports viewport-qualified impressions, clicks, likes/unlikes,
searches, filters, saves, watchlist creation, and recommendation requests with
event IDs. PostgreSQL deduplicates and rolls events into feature tables.

The explainable rules ranker is the active default. The reproducible hybrid
candidate can run disabled, shadow, or guarded-active. The current synthetic
artifact is lifecycle `shadow`, lacks adequate production data, and fails a
diversity promotion gate; it cannot become active merely through configuration.

### Analytics

Listing observations and price changes are persisted independently by the
worker. Asking and confirmed sold prices are distinct, currency partitions are
preserved, and same-timestamp changes are ordered by a monotonic database
version. User-facing analysis prioritizes confirmed sold comparables where
available and falls back to cautious observed ranges.

The fair-value candidate remains unpromoted because its fixture MAE and interval
coverage are worse than the simple observed baseline.

### Premium and alerts

Premium access comes from persisted entitlements, never usernames. A
provider-neutral schema exists for subscriptions and webhook idempotency, but no
billing provider is configured. A development grant endpoint requires a
verified admin identity and is rejected in production.

Provider ingestion matches new/changed listings to enabled watchlists.
PostgreSQL stores idempotent matches, in-app inbox state, frequency/quiet-hour
scheduling, attempts, retry waits, suppression, and dead-letter state. Email,
push, and SMS are disabled; no UI or API should imply otherwise.

## Launch boundary

The internal production architecture is implemented, but a public live-data
launch remains blocked until at least one authorized real provider is configured
and the requested two-provider target remains externally blocked:

- eBay: official adapter complete; production client credentials, Buy API
  partner eligibility/approval, and any required affiliate attribution absent
- Grailed: adapter and fixtures complete; exact written permission and retained
  authorization reference absent

Fixtures and contract tests are not live-provider evidence.

## Intentionally deferred

- live billing until provider credentials and signed-webhook configuration exist
- outbound email until a transactional provider and verified address flow are
  configured end to end
- push and SMS delivery
- ML promotion until temporal production data and every quality/latency/diversity
  gate pass
- authenticity/fake-risk claims until labeled data, calibration, abuse review,
  and an evaluation plan exist
- OAuth/social login and seller/posting/social marketplace tooling

## Success criteria

ClosetSearch is ready for public production only when provider authorization,
current PostgreSQL service-restart and production-style encrypted
backup/restore evidence, all required quality gates, repeated clean test runs, a
no-mock staging smoke, and operational review are all current.
See [TASKS.md](TASKS.md) and
[docs/implementation-report.md](docs/implementation-report.md).
