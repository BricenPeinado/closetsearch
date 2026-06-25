# Grailed Integration Notes

## Current Status

Milestone 12 adds the first authorized Grailed provider path for ClosetSearch.

Current state:

- registered in the shared provider registry as `grailed`
- disabled by default
- fixture-backed for tests and local development
- authorized live scraping only activates when explicit runtime flags are enabled
- mock provider remains available as fallback

Live mode was not exercised against Grailed during this sandboxed implementation pass, so the integration should still be treated as controlled rollout work rather than broad production readiness.

## Authorization Requirement

ClosetSearch must retain written permission from Grailed before enabling live scraping.

Operational rule:

- keep `GRAILED_PROVIDER_ENABLED=false` or `GRAILED_SCRAPING_ALLOWED=false` until that written approval is on file for the current deployment and request profile

## Compliance Rules

The Grailed adapter must not:

- bypass login walls or paywalls
- solve CAPTCHA or interact with anti-bot challenges
- rotate proxies or hide automation
- spoof user identity
- use private, internal, or reverse-engineered APIs
- scrape logged-in-only data
- collect personal seller data beyond what is explicitly permitted

The adapter does:

- use server-side HTTP requests only inside the provider layer
- identify itself with a clear ClosetSearch user agent
- pace requests conservatively
- fail closed when authorization flags are missing

## Data Collected

From approved public listing cards, the current parser attempts to collect only:

- title
- brand
- price text and currency clues
- image URL
- source listing URL
- source listing id when visible
- category when visible
- size when visible
- condition when visible
- listing type when visible

No raw HTML is returned to the frontend-facing API response.

## Required Environment Variables

- `GRAILED_PROVIDER_ENABLED`
- `GRAILED_SCRAPING_ALLOWED`
- `GRAILED_BASE_URL`
- `GRAILED_REQUEST_TIMEOUT_MS`
- `GRAILED_MIN_REQUEST_INTERVAL_MS`
- `GRAILED_MAX_RESULTS_PER_SEARCH`
- `GRAILED_USER_AGENT`

## Request Volume and Pacing

Current default guardrails:

- one Grailed request at a time per provider instance
- minimum `3000ms` between requests
- `5000ms` request timeout by default
- up to `24` normalized results per search pass

If Grailed provides stricter written limits, those limits should override the defaults immediately.

## How To Disable Immediately

Use either of these switches:

- set `GRAILED_PROVIDER_ENABLED=false`
- set `GRAILED_SCRAPING_ALLOWED=false`

Either one disables live scraping and keeps the mock provider path available when runtime fallback allows it.

## Known Limitations

- selector coverage is based on saved fixture HTML and may need refinement against approved fresh samples
- only a minimal public search path is implemented today
- provider-native pagination is intentionally lightweight and still belongs to the next milestone
- no shared caching or retry strategy exists yet beyond conservative pacing and timeout behavior

## Future Milestones

Later work should:

- validate live public-search HTML against approved Grailed samples
- expand safe pagination handling
- add light caching and retry/backoff behavior where permitted
- revisit parser resilience as the public markup evolves
