# Provider Configuration

## Overview

ClosetSearch uses an API-only provider runtime so marketplace adapters can be turned on safely without leaking provider-specific behavior into the web app.

Current behavior:

- the mock provider stays available for local development, tests, and fallback
- Grailed is the first authorized real-provider path in the runtime
- Grailed is disabled by default unless both the provider toggle and scraping authorization gate are enabled
- missing authorization and provider failures degrade to partial results instead of crashing feed or search
- provider health/debug metadata exposes safe status only, never secrets

## Runtime Files

Provider runtime and orchestration live in:

- `apps/api/src/providers/runtime-config.ts`
- `apps/api/src/providers/registry.ts`
- `apps/api/src/providers/orchestrator.ts`
- `apps/api/src/providers/listing-sanitizer.ts`
- `packages/providers/src/grailed/*`

## Environment Variables

Core runtime variables:

- `PROVIDER_RUNTIME_MODE` values: `mock`, `hybrid`, `real`
- `PROVIDER_ALLOW_MOCK_FALLBACK`
- `PROVIDER_REQUEST_TIMEOUT_MS`
- `PROVIDER_MAX_ACTIVE_PROVIDERS`
- `PROVIDER_MOCK_ENABLED`

Grailed variables:

- `GRAILED_PROVIDER_ENABLED`
- `GRAILED_SCRAPING_ALLOWED`
- `GRAILED_BASE_URL`
- `GRAILED_REQUEST_TIMEOUT_MS`
- `GRAILED_MIN_REQUEST_INTERVAL_MS`
- `GRAILED_MAX_RESULTS_PER_SEARCH`
- `GRAILED_USER_AGENT`

## Runtime Modes

- `mock`: only the mock provider runs.
- `hybrid`: mock stays active and Grailed can run beside it when explicitly enabled and authorized.
- `real`: real providers are preferred; if none are runnable and fallback is allowed, mock is activated instead.

## Grailed Authorization Gate

Grailed live scraping stays off unless both of these are true:

- `GRAILED_PROVIDER_ENABLED=true`
- `GRAILED_SCRAPING_ALLOWED=true`

That second flag is the compliance gate. It should only be enabled when the project has retained written permission from Grailed for ClosetSearch and the approved request profile still matches that permission.

## Request Pacing

The Grailed provider is conservative by default:

- request timeout defaults to `5000ms`
- request spacing defaults to `3000ms`
- per-search result normalization is capped at `24` listings
- requests use a clear `ClosetSearchBot/...` user agent with a contact address placeholder

TODOs left intentionally for later milestones:

- shared response caching
- provider-specific retry policy
- cross-request backoff memory
- pagination-aware request dedupe

## Health / Debug Endpoint

`GET /providers/health` returns safe metadata only:

- provider id and display name
- provider mode and health mode (`disabled`, `fixture`, `authorized-live`)
- enabled/configured/active status
- scraping authorization status
- required env var names
- capability metadata
- reason flags like `disabled`, `scraping_not_authorized`, or `mock_fallback`
- last error category when a provider is blocked before execution

It does not return API keys, secret values, or raw provider HTML.

## Mock Fallback Behavior

- the mock provider remains enabled by default
- in `real` mode, if Grailed is enabled but not authorized or otherwise unavailable, mock can still be activated when `PROVIDER_ALLOW_MOCK_FALLBACK=true`
- this keeps local development and UI work unblocked while preserving a truthful provider failure summary

## Testing Commands

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm test`
- `corepack pnpm build`

## Known Limitations

- live Grailed scraping was wired for server-side use, but not exercised against the live site in this sandboxed milestone pass
- parsing currently targets saved public listing-card fixtures and may need selector hardening once real HTML samples are refreshed under the approved process
- pagination and provider-native cursors are still minimal and intentionally deferred
- health/debug output is development-oriented and not auth-protected
- there is still only one real-provider adapter in the runtime

## Milestone 13 Boundary

Milestone 12 establishes the authorized Grailed adapter, parser, normalizer, config, and failure/fallback behavior.

Milestone 13 should focus on:

- real feed/search pagination
- page and cursor handling per provider where allowed
- dedupe across repeated searches and provider pages
- light caching to reduce repeat provider calls
- better surfaced loading/error states once multi-page real data lands
