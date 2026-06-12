# Architecture

## Goal

ClosetSearch should be built as a modular fashion resale discovery platform with clear boundaries between:

- the web app
- the API boundary
- provider adapters
- shared normalized domain models
- persistence and auth layers
- future analytics, personalization, alerts, and trust systems

The architecture should now support the transition from mock foundations to real provider-backed functionality without forcing provider-specific logic into the rest of the product.

## Core Architecture Principle

Provider-specific data must stay inside provider adapters. The rest of the app should depend on normalized listing, search, brand, user, analytics, and risk models.

That principle matters more as the project adds real providers, persistence, and analytics.

## System Boundaries

### Web App

Location: `apps/web`

Responsibilities:

- render feed, search, brand, auth, profile, analytics, and trust surfaces
- display normalized listing cards and user-facing states
- collect user input and call the API boundary
- remain resilient to missing or partial optional fields

Not responsible for:

- provider-specific parsing
- secret handling or API key usage
- direct marketplace integration logic
- database access
- raw analytics computation
- authenticity claims or detection logic

### API App

Location: `apps/api`

Responsibilities:

- expose feed, search, brand, auth, likes, onboarding, analytics, and trust endpoints
- orchestrate provider calls
- normalize and merge provider output
- isolate provider failures from the web app
- own caching, pagination coordination, persistence orchestration, and auth/session boundaries as those systems mature

Not responsible for:

- rendering UI
- leaking provider-specific shapes to clients
- mixing placeholder trust signals into filtering or blocking logic

### Shared Package

Location: `packages/shared`

Responsibilities:

- define stable shared domain types
- keep normalized models consistent across apps and packages
- provide small framework-independent utilities when needed

Shared models should remain product-facing and normalized. They should not become a dumping ground for provider-specific fields.

### Providers Package

Location: `packages/providers`

Responsibilities:

- define provider contracts
- implement mock and real provider adapters
- normalize raw provider responses into shared models
- surface provider capability and error behavior in a controlled way

The mock provider should remain available for local development and test fallback even after real providers exist.

## Current Runtime Shape

```text
Web app
  -> API routes
  -> feed/search/brand/auth/analytics handlers
  -> provider orchestration + lightweight services
  -> normalized shared models
  -> UI rendering
```

Today, much of the data is still mock-backed. The architecture should now evolve so that real provider work and persistence can be added incrementally instead of all at once.

## Provider Runtime Configuration

Real provider support should be added behind explicit runtime configuration.

Recommended architecture:

- provider-specific environment configuration in the API layer
- per-provider enable/disable flags
- central provider registry or selection layer
- capability-aware provider invocation where needed
- clear separation between local mock mode and real provider mode

The web app should not need to know whether data came from mock or real providers.

## Provider Failure Handling

Real providers will fail, rate-limit, or return partial data.

Provider failure handling should include:

- per-provider timeout handling
- recoverable errors that do not crash the full feed/search response
- partial result support where appropriate
- error logging at the API boundary
- stable fallback behavior when one provider fails
- optional provider health/debug endpoints if operationally helpful

One provider failure should not crash the entire product surface.

## Real Data Normalization

All real provider data should be normalized before it leaves provider adapters.

Normalization should handle:

- ids and provider identifiers
- titles and brand names
- image URLs
- source marketplace metadata
- price and currency
- source URLs
- listing type
- missing category, size, or condition data
- pagination metadata

The rest of the app should not need provider-specific if/else branches to render listings.

## Feed and Search Architecture

Feed and search should share normalized listing models but remain separate workflows.

### Feed

Feed responsibilities:

- request provider-backed listing pages
- merge and dedupe results when needed
- support signed-out fallback and signed-in personalization paths
- support load-more or infinite-scroll behavior
- remain usable even when personalization data is sparse

### Search

Search responsibilities:

- accept normalized search input
- map supported filters to active providers
- page through real results
- cache repeated searches lightly where useful
- preserve stable empty/error/loading behavior

Do not let feed ranking logic and explicit search logic collapse into the same implementation by accident.

## Listing Cache

A lightweight listing cache is likely useful once real providers are added.

Possible responsibilities:

- reduce repeated provider calls
- support repeated searches and feed refreshes
- temporarily store normalized listings and pagination metadata
- provide a short-lived buffer for analytics snapshots or dedupe checks

The cache should sit behind the API boundary. Cache strategy should remain simple until real provider behavior justifies more complexity.

## Database Persistence

The current project still relies on lightweight or in-memory foundations. That should change in the post-foundation roadmap.

Persistence architecture should eventually cover:

- users
- onboarding preferences
- likes
- recent searches
- saved searches
- watchlists
- optional listing cache or listing snapshot tables
- analytics snapshots if analytics v1 requires them

Recommended principles:

- add migrations before data usage spreads
- keep persistence models aligned with shared domain concepts where practical
- avoid coupling provider raw payloads directly to product tables

## Auth and Session Layer

The current auth system is a foundation, not a production auth stack.

A more real auth/session layer should include:

- password hashing
- safer credential handling
- session or JWT strategy
- logout/session expiry behavior
- route protection for user-specific operations
- explicit auth error and recovery states

The web app should consume a stable session/user shape, while the API owns credential verification and session lifecycle.

## User Engagement Data

User engagement data should stay separate from provider data.

Examples:

- likes
- onboarding preferences
- saved searches
- saved filters
- watchlists
- notification preferences

This data should feed personalization and alerts later, but it should not leak back into provider adapters.

## Personalization Layer

Personalization should remain a distinct subsystem built on normalized listing data plus user engagement data.

Inputs may include:

- onboarding preferences
- liked brands or categories
- saved searches or watchlists
- recent interactions

Recommended principles:

- keep ranking inputs explainable
- support sparse-user fallback behavior
- avoid overfitting on small user histories
- preserve exploration and diversity controls

## Analytics Snapshots

Analytics should be built from observed data before predictions.

Analytics v1 architecture should favor:

- price snapshot collection
- brand/category price range summaries
- simple under-market comparisons
- explicit sample/mock boundaries when real data is absent

Avoid building forecasting or advanced price prediction systems before observed-data pipelines are reliable.

## Watchlists and Alerts

Watchlists and alerts should build on normalized search and user-engagement models.

Likely architecture pieces:

- saved brands
- saved searches
- watched price ranges
- notification preference storage
- future delivery workers or integrations

The first pass can build the data model and UI shell before adding outbound delivery channels.

## Safe Trust / Risk Signals

Trust signals should remain optional listing annotations.

Architecture rules:

- risk data is assistive, not an authenticity verdict
- risk signals must stay optional on listings
- trust signals must not block, hide, or filter listings
- simple heuristic placeholders are acceptable during the foundation phase
- real trust work must remain cautious, probabilistic, and clearly labeled

Fake-risk should stay separate from analytics, ranking, and provider parsing concerns.

## Mock Provider Role

The mock provider should remain part of the architecture even after real providers are added.

Why keep it:

- reliable local development
- deterministic tests
- fallback when provider credentials are unavailable
- UI work that should not depend on live marketplace stability

Real providers should be added one at a time. The mock provider remains the safest baseline for development and review.

## Reliability Principles

- One provider failure should not crash feed or search.
- Normalized contracts should be validated before data reaches the UI.
- User-facing listing data should remain consistent across sources.
- Real provider work should arrive incrementally, not as a giant rewrite.
- Analytics should start with observed data before predictions.
- Fake-risk should remain probabilistic, assistive, and non-blocking.
