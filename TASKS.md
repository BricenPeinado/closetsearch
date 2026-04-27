# Tasks

ClosetSearch should be built in focused, reviewable passes. Each milestone should leave the repo in a clearer state than it found it.

## Milestone 1: Product and Repo Foundation

- [ ] Refine root documentation
- [ ] Define phased product scope
- [ ] Clarify architecture boundaries
- [ ] Align normalized domain model direction
- [ ] Clarify provider contract direction
- [ ] Confirm repo structure
- [ ] Identify development scripts and standards needed for Milestone 2

Exit criteria:

- README is a useful entry point.
- PRODUCT defines V1, later phases, and non-goals.
- ARCHITECTURE defines system boundaries and implementation direction.
- TASKS is phased and reviewable.
- DECISIONS records durable product and architecture choices.

## Milestone 2: App Skeleton and Tooling

- [ ] Choose package manager and workspace setup
- [ ] Choose web app runtime/framework
- [ ] Choose API runtime/framework
- [ ] Add TypeScript configuration
- [ ] Add lint, typecheck, format, and test scripts
- [ ] Create runnable web app shell
- [ ] Create runnable API app shell
- [ ] Add placeholder routes/pages for Home, Search, and Brands
- [ ] Add basic loading, empty, and error state patterns

Do not add auth, real providers, analytics, fake-risk logic, or personalization in this milestone.

## Milestone 3: Listing and Provider Foundations

- [ ] Finalize normalized listing model
- [ ] Finalize search query model
- [ ] Finalize brand model
- [ ] Finalize provider search contract
- [ ] Add mock provider
- [ ] Add provider normalization tests
- [ ] Add server-side search flow using the mock provider
- [ ] Return frontend-consumable normalized results

Do not add real marketplace integrations until the mock flow and contract are reviewable.

## Milestone 4: Home Feed Foundation

- [ ] Build home feed UI
- [ ] Build listing card component
- [ ] Render normalized listing cards
- [ ] Add simple signed-out feed source
- [ ] Add loading, empty, and error states
- [ ] Add basic pagination or infinite-scroll behavior

Do not add personalized ranking yet.

## Milestone 5: Search Experience

- [ ] Build global search entry point
- [ ] Build search results page
- [ ] Connect search UI to normalized search flow
- [ ] Add initial useful filters
- [ ] Add sort options supported by the provider layer
- [ ] Add source/provider filters when multiple providers exist

Do not build saved searches or account-backed recent searches yet.

## Milestone 6: Brand Browsing

- [ ] Define initial brand dataset
- [ ] Create brand directory page
- [ ] Add brand search/filtering
- [ ] Create individual brand page shell if needed
- [ ] Connect brand pages to search flows where appropriate

## Milestone 7: Accounts and Personalization Foundation

- [ ] Add signup and login
- [ ] Add onboarding survey
- [ ] Save initial user preferences
- [ ] Add likes/hearts
- [ ] Add profile surface
- [ ] Use preferences and likes in simple recommendation rules

## Milestone 8: Premium Analytics Foundation

- [ ] Define premium analytics product boundaries
- [ ] Define premium access behavior
- [ ] Define market insight model
- [ ] Define underpriced listing signal model
- [ ] Add analytics shell only after core feed/search is stable

## Milestone 9: Trust / Fake-Risk Foundation

- [ ] Define safe fake-risk product language
- [ ] Define risk-signal model
- [ ] Establish disclaimers and uncertainty framing
- [ ] Explore source confidence and anomaly inputs
- [ ] Add UI patterns only after core product and analytics foundations are stable

## Rules for Development Passes

- One focused task at a time.
- Keep docs, tooling, contracts, and features in separate passes when possible.
- Verify each pass before continuing.
- Prefer small normalized contracts over source-specific shortcuts.
- Do not overbuild premium analytics, fake-risk intelligence, or personalization before the core discovery/search experience is strong.
