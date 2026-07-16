# Decisions

This file records durable product and architecture decisions. Keep entries short, dated, and easy to revisit.

## Template

### Decision Title

**Date:** YYYY-MM-DD  
**Status:** Proposed | Accepted | Superseded

#### Context

What problem or tradeoff prompted this decision?

#### Decision

What was chosen?

#### Alternatives Considered

What other options were considered?

#### Consequences

What becomes easier, harder, or intentionally deferred?

## Accepted Decisions

### Product Scope Is Phased

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

The product vision includes feed discovery, search, brand browsing, personalization, premium analytics, and fake-risk intelligence. Building all of that at once would blur priorities and make early implementation hard to review.

#### Decision

The initial build will focus on the core discovery/search experience:

- home feed
- search
- brand browsing
- normalized listing cards
- modular provider foundations

Accounts, likes, personalization, premium analytics, and fake-risk intelligence are planned later.

#### Alternatives Considered

- Build accounts and personalization in V1.
- Build premium analytics early.
- Delay documenting future systems entirely.

#### Consequences

The first implementation passes stay focused and reviewable while the docs still preserve the long-term product direction.

### The Home Feed Is the Core Surface

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

ClosetSearch should feel like a visual resale discovery product, not only a utility search box.

#### Decision

The home feed is the primary product surface. It should become a fast, visual, scrollable listing experience.

#### Alternatives Considered

- Prioritize search-only workflows first.
- Treat the homepage as a static landing page.

#### Consequences

Feed quality, listing card design, loading states, pagination, and ranking strategy are top-level product concerns.

### Search Is First-Class and Separate From Feed Logic

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

Feed discovery and intentional search have different user intent, ranking needs, and product behavior.

#### Decision

Search will be implemented as a first-class workflow separate from feed logic, while sharing normalized listing models where appropriate.

#### Alternatives Considered

- Use feed logic for all listing retrieval.
- Treat search as a thin UI filter over the feed.

#### Consequences

Search can support explicit queries, filters, sorting, and provider orchestration without distorting the home feed.

### Provider Integrations Must Be Modular and Normalized

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

Resale marketplaces have different APIs, data shapes, reliability patterns, and listing semantics.

#### Decision

All marketplace integrations must sit behind provider contracts and normalize results into shared ClosetSearch domain models.

#### Alternatives Considered

- Let marketplace-specific response shapes leak into the API or UI.
- Build provider-specific UI paths.

#### Consequences

Provider work can grow incrementally, and the rest of the app can remain stable as providers are added or replaced.

### Premium Analytics Is Deferred Until Core Discovery Works

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

Premium analytics may become valuable, but it depends on reliable listing data, search quality, and user trust.

#### Decision

Premium analytics will be planned in docs but not implemented in the initial build.

#### Alternatives Considered

- Add a premium analytics shell in the first app skeleton.
- Ignore analytics until much later.

#### Consequences

The repo avoids weak monetization scaffolding while preserving a clear future direction.

### Fake-Risk Intelligence Must Be Assistive, Not Definitive

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

Authenticity and fake-risk signals are sensitive. Overconfident product language could mislead users.

#### Decision

Any future fake-risk feature must be framed as an assistive risk signal, not a definitive authenticity judgment.

#### Alternatives Considered

- Present binary fake/authentic labels.
- Avoid defining trust language until implementation.

#### Consequences

Future trust work has a safer product boundary, but no fake-risk scoring or UI should be built before the core product is stable.

### Trust Foundations Must Stay Isolated and Non-Blocking

**Date:** 2026-05-06  
**Status:** Accepted

#### Context

ClosetSearch needs a foundation for future trust work without weakening feed, search, or listing discovery behavior.

#### Decision

The trust foundation may add placeholder risk-signal contracts, mock service output, and subtle UI wording. It must stay optional, assistive, and isolated from ranking, filtering, blocking, analytics, and authenticity claims.

#### Alternatives Considered

- Hide trust work entirely until later milestones.
- Add stronger authenticity warnings during the foundation pass.
- Use trust signals to suppress or reorder listings.

#### Consequences

The repo can establish stable interfaces and wording now while deferring real detection logic, ML, scraping, and enforcement behavior.

### Move from Foundation Milestones to Functional Productization

**Date:** 2026-06-12  
**Status:** Accepted

#### Context

The initial milestones established the main product surfaces, shared models, mock provider flow, and placeholder systems for analytics and trust. The next biggest value is no longer more scaffolding. It is real provider data, persistence, QA, and a path toward beta readiness.

#### Decision

Future work will prioritize real provider data, persistence, QA, auth hardening, and beta readiness over additional placeholder-only systems.

#### Alternatives Considered

- Continue extending placeholder systems before real data work begins.
- Jump directly to advanced analytics or trust logic.
- Treat the current foundation as production-ready.

#### Consequences

The roadmap shifts away from placeholder architecture and toward user-visible functionality, reliability, and operational readiness.

### Mock Provider Remains as Development Fallback

**Date:** 2026-06-12  
**Status:** Accepted

#### Context

The current app uses mock and test data. Real providers will be added gradually and may fail, rate-limit, or require credentials that are not available in every development environment.

#### Decision

Keep the mock provider available for local development, tests, demos, and fallback while real providers are added one at a time.

#### Alternatives Considered

- Remove the mock provider as soon as the first real provider is added.
- Require all development work to depend on live provider access.

#### Consequences

Developers can keep shipping UI and contract changes without depending on external provider uptime, but production paths must clearly distinguish mock data from real data.

### Real Analytics Start with Simple Observed Pricing Signals

**Date:** 2026-06-12  
**Status:** Accepted

#### Context

Premium analytics is part of the product direction, but advanced forecasting or pricing intelligence would be weak without stable provider coverage and observed historical data.

#### Decision

Analytics V1 will start with observed market ranges, price snapshots, and simple under-market comparisons.

#### Alternatives Considered

- Add advanced predictions immediately.
- Delay all analytics until a much later phase.

#### Consequences

The product can create practical pricing context earlier without making unsupported predictions.

### Trust Signals Are Assistive, Not Authenticity Verdicts

**Date:** 2026-06-12  
**Status:** Accepted

#### Context

Fake-risk features are sensitive and can create user harm if they overstate certainty or imply a real authenticity verdict that the product cannot support.

#### Decision

Trust and risk UI must use careful language, remain probabilistic, and avoid fake/authentic certainty claims.

#### Alternatives Considered

- Present stronger authenticity claims for product differentiation.
- Hide trust signals entirely until a future advanced system exists.

#### Consequences

ClosetSearch can surface helpful review signals while reducing user harm, legal risk, and product overclaiming.

### SQLite Is the Initial Persistence Layer

**Date:** 2026-07-02  
**Status:** Accepted

#### Context

ClosetSearch needs persistence for core user state and listing cache behavior, but the project is still early enough that a local, reviewable database is a better fit than introducing Postgres infrastructure or a broader ORM layer immediately.

#### Decision

Milestone 14 uses SQLite inside `apps/api` as the initial persistence layer, configured through `CLOSETSEARCH_DB_PATH` and backed by explicit SQL migrations and seed support.

#### Alternatives Considered

- Keep in-memory and browser-only persistence longer.
- Introduce Postgres immediately.
- Add a larger abstraction or ORM before the persistence requirements are stable.

#### Consequences

Core user state can now survive API restarts with a small operational footprint, but production auth, deployment-grade database strategy, and a future Postgres swap remain later milestones.

### Cookie-Backed Server Sessions Replace Browser-Trusted Identity

**Date:** 2026-07-05  
**Status:** Accepted

#### Context

Milestone 14 introduced SQLite persistence, but the app was still trusting browser-local identity and lightweight password hashing. Protected routes could still accept arbitrary `userId` values, the browser could treat local storage as authenticated identity, and there was no server-side session revocation path.

#### Decision

Milestone 15 uses cookie-backed server sessions stored in SQLite instead of browser-trusted local identity or client-managed JWTs.

The auth foundation now includes:

- slow password hashing with `crypto.scrypt`
- server-side `auth_sessions` records
- hashed session tokens in storage
- `HttpOnly` session cookies
- authenticated route protection based on the current session instead of request-body or query-string `userId`

#### Alternatives Considered

- keep localStorage as the source of authenticated identity longer
- move directly to client-managed JWTs
- add OAuth before the local auth foundation is stable

#### Consequences

ClosetSearch now has a safer, reviewable auth baseline that:

- requires credentialed API requests from the web app
- requires tighter CORS rules for trusted local origins
- supports server-side logout and revocation
- keeps future migration to stronger auth and broader account features possible

OAuth, email verification, password reset, advanced recovery, and broader account-management features remain later milestones.

### Saved User Features Stop at Persistence, Not Delivery

**Date:** 2026-07-10  
**Status:** Accepted

#### Context

Milestone 16 needs to make the signed-in account surface genuinely useful without reopening the auth foundation or dragging in alerts, notifications, or deeper personalization logic too early.

#### Decision

Saved-user work in Milestone 16 stops at persisted account data and account UI:

- persistent liked items
- saved searches
- saved filters / presets
- watchlist shell records
- basic user settings and profile improvements

Watchlists are stored intent only for now. They do not trigger alerts, background jobs, email delivery, push notifications, or personalization V2 behavior yet.

#### Alternatives Considered

- bundle alerts and watchlists together in the same milestone
- delay all saved-user work until personalization and alerts are ready
- add a larger account-system redesign instead of a focused saved-features pass

#### Consequences

The account area becomes meaningfully useful now, core user data survives refreshes and restarts, and later milestones can build delivery and personalization on stable persisted user intent instead of reworking the storage model.


### Explainable Rule-Based Personalization Comes Before ML

**Date:** 2026-07-14  
**Status:** Accepted

#### Context

Milestone 17 needs a noticeably better signed-in feed, but the product is still early: provider coverage is still growing, analytics are still placeholder, and saved-user data only recently became persistent. This is the wrong stage to add embeddings, vector search, or opaque recommendation models.

#### Decision

Personalization V2 uses explainable rules-based scoring before any ML-driven recommendation stack.

The feed now ranks signed-in listings using reviewable inputs such as:

- liked listing snapshots
- onboarding preferences
- saved searches
- saved filters
- watchlist shell intent as a weak signal
- preferred sources from user settings
- freshness, listing completeness, impression-count engagement, diversity, and repetition penalties

The API can also return debug score breakdowns on `GET /feed?debugPersonalization=1` so tests and development review can inspect why a listing ranked where it did without exposing sensitive account details.

#### Alternatives Considered

- jump directly to embeddings or vector search
- wait for real analytics or provider scale before improving the feed at all
- build a heavier recommendation service that would be difficult to inspect at this stage

#### Consequences

This approach is easier to test, easier to debug, and appropriate for the current product stage while keeping the future path to ML open. It also forces ranking behavior, diversity controls, and cold-start fallback rules to stay explicit instead of becoming implicit inside an opaque model too early.

### Observed Analytics Must Stay Cautious and Non-Predictive

**Date:** 2026-07-16  
**Status:** Accepted

#### Context

ClosetSearch now records real observed listing prices, which makes it possible to add more meaningful pricing context. That same capability creates pressure to overstate certainty with forecasting, investment framing, or guaranteed underpriced claims before the product has enough reliable history.

#### Decision

Analytics V1 will stay limited to observed price snapshots, brand/category ranges, same-currency similar-listing comparisons, and cautious labels such as below observed range or not enough observed data.

#### Alternatives Considered

- Add price predictions and trend forecasting immediately.
- Present stronger underpriced language to make analytics feel more actionable.
- Delay all analytics until a larger market-intelligence system exists.

#### Consequences

The analytics layer is safer, easier to test, and easier to explain to users. It also creates a durable snapshot foundation for later pricing intelligence without committing the product to unsupported financial or authenticity claims.
