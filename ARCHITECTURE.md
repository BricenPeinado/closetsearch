# Architecture

## Goal

ClosetSearch should be built as a modular fashion resale discovery platform with clear boundaries between:

- the user-facing web app
- the API boundary
- provider integrations
- shared domain models
- future personalization, analytics, and trust systems

The initial architecture should support the core discovery/search product without overbuilding future systems.

## System Boundaries

### Web App

Location: `apps/web`

Responsibilities:

- render the home feed surface
- render search and brand browsing surfaces
- display normalized listing cards
- handle loading, empty, and error states
- call the API boundary or local development handlers

Not responsible for:

- provider-specific parsing
- raw marketplace response handling
- auth, analytics, payments, or fake-risk logic in the initial build

### API App

Location: `apps/api`

Responsibilities:

- expose feed/search endpoints or handlers
- orchestrate provider calls
- return normalized listing responses
- isolate web-facing response shapes from provider internals
- handle partial provider failures gracefully

Not responsible for yet:

- persistent user accounts
- payment or subscription behavior
- premium analytics processing
- fake-risk scoring

### Shared Package

Location: `packages/shared`

Responsibilities:

- define stable domain types shared across apps and packages
- hold small, framework-independent utilities when needed
- avoid UI-specific and provider-specific concerns

### Providers Package

Location: `packages/providers`

Responsibilities:

- define the provider contract
- contain marketplace adapters when provider work begins
- normalize provider-specific listing data into shared domain models
- keep provider failures isolated from the rest of the app

## Core Data Flow

```text
User opens feed or submits search
  -> Web app requests feed/search data
  -> API selects provider behavior
  -> Provider adapters fetch or mock marketplace data
  -> Provider layer normalizes listings
  -> API returns normalized results
  -> Web app renders listing cards
```

Feed and search should share normalized listing models, but they should not share ranking/query logic by accident.

## Feed Direction

The home feed is the primary product surface.

Initial feed behavior should be simple:

- signed-out by default
- based on provider results, curated seed data, or mock listings while infrastructure is immature
- no learned personalization
- no account dependency

Later feed behavior can add:

- onboarding preferences
- likes and engagement signals
- saved preferences
- diversity and exploration rules
- learned personalization

## Search Direction

Search is first-class and separate from feed logic.

Search should:

- accept a normalized `SearchQuery`
- call one or more providers through the provider contract
- normalize provider responses into shared listing results
- support pagination when providers can supply it
- apply only filters that are supported by the current provider layer

Filters and sorting should be added incrementally. The first implementation should prove the full path with a small set of useful fields.

## Normalized Domain Models

The current shared package has starter types only. Before real provider work, the project should align on a normalized listing model that can support both feed and search.

Recommended core models:

### Brand

- `id`
- `slug`
- `name`
- `aliases` later, only when needed

### SearchQuery

- text query
- brand filters
- size filters
- category filters
- condition filters
- source/provider filters
- listing type filters
- price range
- sort mode
- currency preference
- pagination cursor or page token

### Listing / SearchResult

Use one normalized item shape for feed and search results. The project should choose a final name before Milestone 3. `Listing` is the clearer domain name; `SearchResult` can remain an API-facing alias if needed.

Recommended fields:

- internal id
- provider id
- provider listing id
- source URL
- title
- brand
- image URL
- price amount
- price currency
- category
- size
- condition
- listing type
- fetched timestamp

Do not add analytics, authenticity, or personalization fields to this model until those phases begin.

## Provider Contract

Providers must be modular and normalized.

The provider contract should eventually define:

- provider id and display name
- supported capabilities, when needed
- `search(query)` behavior
- normalized results
- pagination metadata
- recoverable error behavior

Provider adapters may use APIs, scraping, fixtures, or mocks internally, but raw provider response shapes must not leak into `apps/web` or general API responses.

For early implementation, start with the smallest contract that can return normalized listings from a mock provider. Expand only when a real provider requires it.

## Future Systems

### Accounts and Personalization

Accounts, onboarding, likes, profiles, and personalized ranking are planned later. Architecture should leave room for them but not build them into the first feed/search implementation.

### Premium Analytics

Premium analytics is a future subsystem for pricing and market insights. It should not influence V1 domain models beyond avoiding names that would block future analytics.

### Fake-Risk Intelligence

Fake-risk intelligence is a future trust subsystem. It should be treated as probabilistic and assistive. No fake-risk model, scoring, or UI should be added during the initial build.

## Engineering Direction

- Use TypeScript for shared contracts.
- Keep app/package boundaries explicit.
- Add a real workspace setup in Milestone 2 before app implementation grows.
- Add lint, typecheck, test, and formatting standards with the app skeleton.
- Avoid adding a database until a milestone requires persistence.
- Avoid provider-specific code until the provider contract is ready.

## Reliability Principles

- One provider failure should not crash feed/search.
- Normalized contracts should be validated before data reaches the UI.
- User-facing listing data should remain consistent across sources.
- Loading, empty, and error states should be implemented with the first real UI surfaces.
