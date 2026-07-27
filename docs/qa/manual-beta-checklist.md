# Manual Product and Staging Checklist

Record environment, commit/image digests, PostgreSQL schema version, provider
IDs/authorization reference, model mode/version, and whether fixture data is
present. Public staging must contain no fixtures.

## Health and persistence

- [ ] web, `/health/live`, `/health/ready`, `/metrics`,
      `/operations/status`, `/providers/health`
- [ ] operational endpoints reject a missing/incorrect bearer token and accept
      the monitored secret without logging it
- [ ] readiness reports PostgreSQL, no pending/drifted migration, real provider
- [ ] restart API and verify sessions/saved state persist
- [ ] restart worker and verify lease/checkpoint resume without duplicate prices
- [ ] confirm schema migrations `001` through `007`

## Feed/search/listings

- [ ] signed-out and signed-in feed
- [ ] true infinite scroll and accessible Load More
- [ ] no duplicate cards across multiple pages/back navigation
- [ ] URL query/filter/sort/currency survives refresh/share
- [ ] brand/category/size/condition/source/type/status/price/currency controls
- [ ] image aspect reservation, lazy load, local failure fallback
- [ ] original/display price is truthful; no relabeled unconverted amount
- [ ] status/freshness/seller/shipping/marketplace action only when supported
- [ ] listing detail gallery, original Japanese/translation labels, auction
      bid/buy-now/end state, price trend, and domestic/proxy limitation copy
- [ ] partial provider, stale cache, all-provider failure, offline, empty, retry
- [ ] no production mock provider/listing

## Accessibility/mobile

- [ ] keyboard reaches navigation, filters, cards, likes, Load More, dialogs
- [ ] visible focus and useful accessible names/state
- [ ] axe-core A/AA scan passes and contrast is manually reviewed
- [ ] major pages at narrow and wide viewports
- [ ] reduced-motion/zoom behavior remains usable

## Auth and account

- [ ] signup policy, login, logout, logout-all
- [ ] expired/revoked session recovers cleanly
- [ ] cross-origin cookie mutation rejected
- [ ] email save and verification request
- [ ] generic password-reset request does not enumerate accounts
- [ ] one-time verify/reset/export links reject reuse/expiry
- [ ] password reset revokes all sessions
- [ ] JSON export excludes credential/token/IP hashes
- [ ] exact-username deletion removes owned state and clears cookie
- [ ] disabled email provider copy does not imply delivery

## Saved state and alerts

- [ ] like/unlike, searches, filters, watchlists, settings survive refresh
- [ ] watchlist edit/pause/resume/delete
- [ ] new/changed ingested listing creates one match
- [ ] inbox unseen/seen/dismissed state
- [ ] frequency/quiet-hour scheduling
- [ ] email/SMS controls expose readiness and cannot save an unusable channel
- [ ] push enable attempts remain unavailable
- [ ] outbound delivery is not claimed without a configured transport,
      verified destination, current consent, and staging evidence

## Engagement and recommendations

- [ ] no view event before 50% visibility for one second
- [ ] one qualified view per event/card rule
- [ ] open/like/unlike/search/filter/save/watchlist/recommendation events
- [ ] duplicate event IDs accepted idempotently
- [ ] spoofed user/direct identifier/secret properties rejected
- [ ] disabled/shadow/failure/timeout recommendation returns rules
- [ ] response metadata contains version/reason but no sensitive feature values

## Entitlements and analytics

- [ ] free, active, expired, revoked entitlement behavior
- [ ] username cannot grant premium
- [ ] development grant disabled in production
- [ ] asking/sold basis is explicit
- [ ] comparable count, freshness, currency, source coverage, disclaimers
- [ ] limited/currency-mismatch states
- [ ] no prediction/profit/investment/authenticity wording

## Provider/operations

- [ ] all intended authorized provider IDs are active; blocked list understood
- [ ] rate limit honors `Retry-After`; circuit/partial banner appears
- [ ] worker checkpoint/health/last-success advances
- [ ] operations status degrades or returns its stable unavailable response when
      durable state cannot be read; no payload/cursor/raw error is exposed
- [ ] HTTP metric routes have bounded labels with query strings and IDs removed
- [ ] stale job/provider/checkpoint gauge series clear after state changes
- [ ] fresh encrypted backup and isolated restore evidence
- [ ] canary and rollback to previous immutable images rehearsed
- [ ] logs/metrics contain no secrets or raw sensitive data
