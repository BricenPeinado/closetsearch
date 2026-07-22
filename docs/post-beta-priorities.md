# Post-Beta Priorities

This list keeps beta triage disciplined by separating immediate beta hardening from wider public-launch work.

## Must Fix Before Public Launch

- stronger provider depth and live-data reliability
- production-grade database and backup strategy
- stronger observability and incident-response tooling
- password reset, email verification, and fuller account recovery
- clearer rollout and rollback automation beyond docs-first beta operations

## Should Fix Before Public Launch

- richer provider-limited and degraded-state UX across every surface
- broader mobile and accessibility review
- better admin and moderation tooling
- improved analytics coverage once more observed data exists
- more robust smoke checks and deploy validation

## Later Improvements

- multiple real providers with smarter merging
- richer recommendation controls
- better saved-item organization
- more complete beta feedback intake automation

## Deferred Feature Ideas

- real watchlist delivery
- premium packaging and billing
- broader personalization controls
- deeper analytics beyond observed pricing context

## Known Product Risks

- users may overread analytics or trust copy if disclaimers become too subtle
- provider incompleteness can still make the product feel inconsistent across categories
- limited data can make beta users question result quality even when the app is functioning correctly

## Known Technical Risks

- SQLite is still the operational persistence layer
- provider adapters can still break if upstream HTML or APIs change
- observability remains intentionally lightweight for beta
- session and deployment behavior still depend on careful environment setup
