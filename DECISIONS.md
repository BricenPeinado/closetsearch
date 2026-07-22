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

### Alert-Ready Watchlists Ship Before Notification Delivery

**Date:** 2026-07-16  
**Status:** Accepted

#### Context

Milestone 19 needs to let signed-in users save what they want to track next without implying that ClosetSearch already has a reliable notification system. The product has persistence, auth, saved-user features, personalization, and observed analytics foundations now, but it does not yet have trustworthy outbound delivery, monitoring workers, or suppression rules.

#### Decision

Milestone 19 ships alert-ready watchlists before real notification delivery.

The implementation now includes:

- authenticated watchlist CRUD scoped to the active session user
- watchlists for watched brands, searches, marketplaces, listing types, price ranges, size, and condition
- saved notification preference shell data
- a pure watchlist-to-listing matcher with explainable reasons
- an alert-match foundation table for future deduped candidate matches

The implementation does not yet include:

- email delivery
- push delivery
- SMS delivery
- real-time monitoring loops
- production background alert workers

#### Alternatives Considered

- delay watchlists until a full notification pipeline exists
- ship email or push alert delivery immediately with a thinner data foundation
- add background monitoring and delivery infrastructure in the same milestone

#### Consequences

Users can save intent now, the repo gets a clean data foundation for later alerting work, beta scope stays honest, and future delivery milestones can focus on matching cadence, suppression, and outbound channels without reworking account contracts again.

### Constrained Beta Comes Before Public Launch

**Date:** 2026-07-17  
**Status:** Accepted

#### Context

ClosetSearch now has enough feed, search, auth, saved-user, personalization, analytics, and watchlist functionality to start collecting real tester feedback. It still lacks the provider depth, operational maturity, account recovery, and observability expected of a public launch.

#### Decision

ClosetSearch will prepare for a constrained beta before any wider public launch.

This stage prioritizes:

- documented setup and deployment steps
- environment clarity
- honest privacy, data-use, and limitation copy
- manual QA readiness
- structured tester feedback collection

#### Alternatives Considered

- treat the current repo as public-launch ready
- delay beta until every deferred production concern is solved
- add large new features before documenting and stabilizing the current core flows

#### Consequences

The team can learn from real testers sooner while keeping scope honest. It also forces documentation, QA, and operational discipline to improve before more feature breadth is added.

### Beta Copy Must Stay Honest About Observed Analytics and Inactive Alerts

**Date:** 2026-07-17  
**Status:** Accepted

#### Context

Beta testers will see analytics, trust wording, and watchlist flows early enough that confusing or overconfident copy could damage trust even if the underlying code works.

#### Decision

Beta user-facing copy must continue to state that:

- analytics are based on observed listings only
- analytics are not financial advice or predictions
- trust signals are assistive only
- watchlists save intent only and do not provide live delivery yet

#### Alternatives Considered

- soften the disclaimers to make the beta feel more polished
- hide limitation copy from testers unless they ask for it
- promise future alert delivery too aggressively in the UI

#### Consequences

The beta remains easier to trust, easier to review, and less likely to create false expectations about pricing certainty, authenticity, or active alert delivery.

### Lightweight Structured Logging and Docs-First Operations Come Before Heavy Observability

**Date:** 2026-07-17  
**Status:** Accepted

#### Context

ClosetSearch needs safer request and provider-error visibility for beta, but this repo is still too early for a full logging platform, tracing stack, or heavy operational tooling rollout.

#### Decision

Milestone 20 uses lightweight structured logging, request IDs, deployment checklists, environment docs, QA docs, and limitation docs before introducing heavier observability systems.

#### Alternatives Considered

- add a large third-party logging or monitoring platform immediately
- keep ad hoc `console` logging with no documentation improvements
- defer operational work until after a beta starts failing

#### Consequences

The repo gets safer logs, clearer setup guidance, and better beta support now while keeping future observability options open.

### Beta Triage and Stability Come Before Feature Expansion

**Date:** 2026-07-22  
**Status:** Accepted

#### Context

ClosetSearch now has enough surface area that a real beta can generate many possible requests, rough edges, and future ideas. Reacting to every tester comment as immediate roadmap scope would make the product less stable, not more.

#### Decision

Milestone 21 prioritizes beta feedback structure, triage discipline, provider and auth recovery hardening, and small launch-blocking fixes before any broader feature expansion.

This means ClosetSearch should:

- collect beta issues in structured templates
- classify problems by severity and owner area
- fix launch-blocking and trust-damaging bugs first
- document post-beta work instead of widening scope in the middle of triage

#### Alternatives Considered

- treat all beta feedback as equal priority
- expand into new features while beta stability problems are still open
- delay triage process work until after the first beta wave becomes noisy

#### Consequences

The beta becomes more actionable, release decisions stay grounded in severity instead of volume, and the repo avoids turning early tester feedback into uncontrolled roadmap churn.

### Release-Candidate Hardening Comes Before Further Feature Expansion

**Date:** 2026-07-20  
**Status:** Accepted

#### Context

ClosetSearch has already completed a constrained beta-readiness pass and a beta stability pass. At this stage, the bigger risk is not missing feature breadth. It is mixing launch-candidate validation with new scope, which would make smoke testing, rollback, and release judgment less trustworthy.

#### Decision

Milestone 22 prioritizes release-candidate hardening before any further feature expansion.

This means the repo should focus on:

- freezing the preview release scope
- documenting release, rollback, and go / no-go steps
- keeping smoke tests repeatable
- separating true launch blockers from accepted deferred work
- preserving honest analytics, watchlist, and provider limitation copy

#### Alternatives Considered

- continue feature expansion while trying to prepare a release candidate
- cut a release candidate without explicit rollback or blocker tracking
- treat beta stability work as enough release discipline on its own

#### Consequences

Launch decisions stay focused, rollback remains practical, and user trust is better protected. The cost is that some otherwise appealing feature ideas remain intentionally deferred until after the launch-candidate cut.
