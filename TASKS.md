# Tasks

ClosetSearch should be built in focused, reviewable passes. Each milestone should leave the repo in a clearer, more functional state than it found it.

## Foundation Roadmap

These milestones established the current app skeleton, placeholder systems, and shared contracts.

## Milestone 1: Product and Repo Foundation

- [x] Refine root documentation
- [x] Define phased product scope
- [x] Clarify architecture boundaries
- [x] Align normalized domain model direction
- [x] Clarify provider contract direction
- [x] Confirm repo structure
- [x] Identify development scripts and standards needed for Milestone 2

Exit criteria:

- README is a useful entry point.
- PRODUCT defines current foundation, V1 target, later phases, and non-goals.
- ARCHITECTURE defines system boundaries and implementation direction.
- TASKS is phased and reviewable.
- DECISIONS records durable product and architecture choices.

## Milestone 2: App Skeleton and Tooling

- [x] Choose package manager and workspace setup
- [x] Choose web app runtime/framework
- [x] Choose API runtime/framework
- [x] Add TypeScript configuration
- [x] Add lint, typecheck, format, and test scripts
- [x] Create runnable web app shell
- [x] Create runnable API app shell
- [x] Add placeholder routes/pages for Home, Search, and Brands
- [x] Add basic loading, empty, and error state patterns

## Milestone 3: Listing and Provider Foundations

- [x] Finalize normalized listing model
- [x] Finalize search query model
- [x] Finalize brand model
- [x] Finalize provider search contract
- [x] Add mock provider
- [x] Add provider normalization tests
- [x] Add server-side search flow using the mock provider
- [x] Return frontend-consumable normalized results

## Milestone 4: Home Feed Foundation

- [x] Build home feed UI
- [x] Build listing card component
- [x] Render normalized listing cards
- [x] Add simple signed-out feed source
- [x] Add loading, empty, and error states
- [x] Add basic pagination or infinite-scroll behavior

## Milestone 5: Search Experience

- [x] Build global search entry point
- [x] Build search results page
- [x] Connect search UI to normalized search flow
- [x] Add initial useful filters
- [x] Add sort options supported by the provider layer
- [x] Add source/provider filters when multiple providers exist

## Milestone 6: Brand Browsing

- [x] Define initial brand dataset
- [x] Create brand directory page
- [x] Add brand search/filtering
- [x] Create individual brand page shell if needed
- [x] Connect brand pages to search flows where appropriate

## Milestone 7: Accounts and Personalization Foundation

- [x] Add signup and login
- [x] Add onboarding survey
- [x] Save initial user preferences
- [x] Add likes/hearts
- [x] Add profile surface
- [x] Use preferences and likes in simple recommendation rules

## Milestone 8: Premium Analytics Foundation

- [x] Define premium analytics product boundaries
- [x] Define premium access behavior
- [x] Define market insight model
- [x] Define underpriced listing signal model
- [x] Add analytics shell only after core feed/search is stable

## Milestone 9: Trust / Fake-Risk Foundation

- [x] Define safe fake-risk product language
- [x] Define risk-signal model
- [x] Establish disclaimers and uncertainty framing
- [x] Explore source confidence and anomaly inputs
- [x] Add UI patterns only after core product and analytics foundations are stable

## Post-Foundation Functional Roadmap

The next milestones focus on turning the current foundation into a more real, reliable product. Real provider data, persistence, auth, and QA now take priority over additional placeholder systems.

## Milestone 10: Stabilization + QA Baseline

- [x] Verify all routes load correctly
- [x] Fix TypeScript, test, and build issues
- [x] Test feed, search, brands, auth, profile, analytics, and risk flows together
- [x] Remove stale milestone or scaffold copy from the UI if any remains
- [x] Document known limitations and fragile areas

Exit criteria:

- The app builds and typechecks cleanly.
- Core routes are manually verified.
- Known limitations are documented instead of hidden.

## Milestone 11: Real Data Provider Foundation

- [x] Add provider environment configuration
- [x] Add provider enable/disable flags
- [x] Add API-key handling patterns
- [x] Add provider error boundaries and fallback behavior
- [x] Add rate-limit friendly request patterns
- [x] Add normalized real-data tests
- [x] Add a provider health/debug endpoint if useful

Exit criteria:

- Real providers can be turned on or off cleanly.
- Secrets and provider failures stay outside the UI layer.
- Mock and real provider paths are testable side by side.

## Milestone 12: First Real Provider Integration

- [x] Add the first real marketplace provider
- [x] Normalize real listings into shared models
- [x] Support real image, title, brand, source, price, and `sourceUrl`
- [x] Handle missing or partial provider fields safely
- [x] Add provider-specific tests
- [x] Keep the mock provider available for local fallback

Exit criteria:

- One real provider works through the shared provider contract.
- The app can render real listings without source-specific UI logic.

## Milestone 13: Real Feed + Pagination

- [x] Connect feed and search to real provider pagination
- [x] Support infinite scroll or load-more with real cursors/pages
- [x] Dedupe listings across pages and providers
- [x] Improve loading, error, and empty states for real fetches
- [x] Add light caching for repeated searches where useful

Exit criteria:

- Feed and search can page through real results reliably.
- Repeated requests behave predictably and do not spam providers.

## Milestone 13.5: Grailed Dynamic Credentials + Integrated Scraping Engine

- [x] Implement dynamic HTML credential extractor
- [x] Establish an in-memory/cache credential storage engine
- [x] Build automated token rotation and 401/403 retry handling
- [x] Build the direct Algolia market querying engine for active and sold listings
- [x] Map Grailed market hits into normalized ClosetSearch listing types
- [x] Add robust error handling, browser-mimicking headers, and rate-limit safeguards
- [x] Update tests and provider documentation

Exit criteria:

- Grailed credentials are harvested dynamically instead of hardcoded.
- Authorized-live Grailed queries can recover once from rotated Algolia credentials.
- Active listings and sold comps stay behind normalized provider boundaries.

## Milestone 14: Database Persistence

- [x] Choose the database direction
- [x] Persist users
- [x] Persist onboarding preferences
- [x] Persist likes
- [x] Persist recent and saved searches
- [x] Persist listing cache if useful
- [x] Add migration and seed strategy

Exit criteria:

- Core user state survives restarts.
- Migrations and seed data are documented and runnable.

## Milestone 15: Production Auth Foundation

- [x] Replace lightweight auth with a safer auth flow
- [x] Add password hashing
- [x] Add sessions or JWT strategy
- [x] Add route protection rules where appropriate
- [x] Add logout and session-expiry behavior
- [x] Add auth error handling and recovery states

Exit criteria:

- The auth system is no longer demo-grade.
- Session behavior is predictable and documented.

## Milestone 16: Saved User Features

- [x] Add persistent liked items
- [x] Add saved searches
- [x] Add saved filters
- [x] Add watchlist shell
- [x] Improve the profile surface
- [x] Add user settings such as preferred currency

Exit criteria:

- Key user actions persist across sessions.
- Profile becomes a useful account surface instead of a foundation shell.

## Milestone 17: Personalization V2

- [x] Refine ranking weights
- [x] Use real likes and preferences
- [x] Improve brand and category boosts
- [x] Add diversity and exploration balancing
- [x] Avoid repetitive feed results
- [x] Document recommendation scoring inputs

Exit criteria:

- Personalized results are noticeably better than generic fallback.
- Recommendation inputs remain explainable and reviewable.

## Milestone 18: Real Analytics V1

- [x] Collect price snapshots
- [x] Compute simple brand and category pricing ranges
- [x] Compare listing price to observed market ranges
- [x] Show simple under-market signals
- [x] Keep disclaimers clear
- [x] Avoid unsupported predictions

Exit criteria:

- Analytics provide useful observed pricing context.
- The product still avoids forecasting claims it cannot support.

## Milestone 19: Alerts + Watchlists

- [ ] Add watched brands
- [ ] Add watched searches
- [ ] Add watched price ranges
- [ ] Add an alert-ready data model
- [ ] Add notification preference shell
- [ ] Leave email/push integration for a later dedicated pass

Exit criteria:

- Users can save intent, even if delivery channels remain basic at first.
- The data model supports future notifications cleanly.

## Milestone 20: Beta Launch Readiness

- [ ] Create a deployment checklist
- [ ] Document environment variables
- [ ] Improve logging and error handling
- [ ] Add privacy and data-use copy
- [ ] Define seed/demo data strategy
- [ ] Create a manual QA checklist
- [ ] Document known limitations
- [ ] Define a beta feedback plan

Exit criteria:

- The app is honest about its limits.
- The repo is ready for a constrained beta, not full production scale.

## Rules for Development Passes

- One focused pass at a time.
- Keep docs, tooling, contracts, and features in separate passes when possible.
- Verify each pass before continuing.
- Prefer small normalized contracts over source-specific shortcuts.
- Do not overbuild premium analytics, AI, or fake-risk before core discovery and search are strong.
- Real provider data, persistence, and QA now take priority over additional placeholder systems.
