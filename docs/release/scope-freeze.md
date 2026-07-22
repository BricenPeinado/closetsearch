# Launch Candidate Scope Freeze

## Purpose

This launch candidate is for a constrained ClosetSearch preview release cut. It is not a full public-production launch and should not be treated like one.

## Included in the Launch Candidate

- feed browsing
- search with filters and sorting
- brand directory and brand detail handoff into search
- signup, login, logout, onboarding, and cookie-backed sessions
- persistent likes, saved searches, saved filters, watchlists, and settings
- explainable personalization from saved-user signals
- observed-data analytics with cautious disclaimers
- beta/privacy/data-use docs
- smoke-test, release, rollback, and go/no-go docs

## Explicitly Excluded

- payments or subscriptions
- real email, push, or SMS alert delivery
- real-time watchlist monitoring
- advanced ML recommendations
- advanced price prediction or investment guidance
- authenticity verdicts or fake-detection claims
- full production observability stack
- full production database and account-recovery platform

## What Counts as a Launch Blocker

- install, build, lint, test, or smoke test fails
- deploy cannot start or health endpoints are broken
- signup, login, logout, or session recovery is broken
- feed or search is unusable
- provider failures crash the page instead of degrading safely
- saved-user data corrupts, disappears, or updates unsafely
- logs or UI expose secrets
- analytics or watchlist copy makes unsupported claims
- rollback cannot be executed safely

## What Does Not Count as a Launch Blocker

- future feature requests outside current scope
- minor copy polish
- small visual improvements
- advanced provider expansion
- deeper analytics ambition beyond observed-data pricing context
- premium packaging or broader growth work

## Intended Audience

- internal reviewers
- a small preview tester group
- maintainers preparing a tagged release candidate and deployment rehearsal

## Accepted Risks for This Launch Candidate

- provider coverage remains limited and may rely on mock or fallback modes
- SQLite remains the operational persistence layer
- auth is stronger than early milestones but still lacks password reset and full recovery
- analytics are useful context only when enough observed data exists
- watchlists save intent only and do not deliver notifications

## Deferred Work After the Launch Candidate

- stronger live-provider coverage
- production-grade persistence and backups
- broader observability and incident tooling
- full account recovery
- real watchlist delivery
- deeper analytics and personalization work
