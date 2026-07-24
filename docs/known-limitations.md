# Known Limitations

ClosetSearch can produce a constrained preview launch candidate, not a full public production launch.

## Product Scope

- beta quality only; expect rough edges
- provider coverage is still limited
- some environments may rely on mock or sample data
- there is no billing or subscription system

## Listings and Providers

- listings can disappear, change price, or go stale after ClosetSearch observes them
- provider data can be incomplete, delayed, or temporarily unavailable
- feed or search results may be limited when one marketplace fails even if the page still loads
- authorized live provider paths still require careful configuration and approval

## Auth and Accounts

- cookie-backed auth is a safer foundation, but not a full account platform yet
- beta testers may need to log in again after session expiry or auth configuration changes
- hashed one-time email verification, password-reset, and export services exist,
  but their authenticated routes and web UI are not integrated yet
- outbound account email is disabled until an approved provider is configured
- breached-password checking has an injectable policy boundary but no approved
  production provider yet
- account export/deletion services exist but are not user-facing yet

## Saved Features and Watchlists

- likes, saved searches, saved filters, and watchlists persist, but watchlists only save intent
- watchlist delivery is not active yet
- there is no real email, push, or SMS notification delivery
- there is no background monitoring loop dedicated to alerts yet

## Analytics

- analytics are based on observed listings only
- analytics are not forecasts, predictions, or investment guidance
- there are no guaranteed underpriced claims
- observed ranges are only as strong as the listings ClosetSearch has seen

## Trust and Risk Signals

- trust or fake-risk signals are assistive only when present
- they are not authenticity verdicts
- they should not be treated as definitive proof

## Operations

- persistence is still SQLite-based
- observability is lightweight and docs-first rather than production-grade
- there is limited admin and moderation tooling
- release docs and smoke checks now exist, but production-scale deployment hardening is still incomplete
