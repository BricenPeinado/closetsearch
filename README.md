# ClosetSearch

ClosetSearch is a fashion resale discovery app. The goal is to help users browse a visual feed, search across resale listings, explore brands, save interesting pieces, and eventually benefit from lightweight personalization and pricing context without turning the product into a noisy dashboard.

The repo is documentation-led and milestone-based. Foundation work is already in place, and the project is now moving from placeholder architecture into real-data and productization passes.

## Current Status

ClosetSearch has completed its initial foundation milestones and is now moving into real-data and productization work.

Completed foundation milestones:

- product and repo foundation
- app skeleton and tooling
- listing and provider foundations
- home feed foundation
- search experience foundation
- brand browsing foundation
- accounts and personalization foundation
- premium analytics foundation
- trust / fake-risk foundation placeholder

What is implemented now:

- web app shell in `apps/web`
- API app shell in `apps/api`
- normalized shared listing, search, brand, user, analytics, and risk types in `packages/shared`
- mock provider flow in `packages/providers`
- home feed with listing cards and load-more behavior
- search with filters, sorting, and recent searches
- brand directory and brand detail shell
- signup, login, onboarding, profile, and likes/hearts foundations
- simple signed-in personalization based on likes and onboarding preferences
- premium analytics placeholder surfaces and mock signals
- trust / fake-risk placeholder signals with careful assistive wording

What is still placeholder, mock, or intentionally lightweight:

- listing data is still mock/test data
- real marketplace provider integrations are not complete
- auth is still a lightweight foundation, not a production-grade auth stack
- persistence is still in-memory or browser-local foundation behavior
- analytics are placeholder foundations, not real market analytics
- fake-risk is a trust placeholder, not real authenticity detection
- there is no production-ready billing, subscriptions, watchlist delivery, or deployment hardening yet

## Roadmap Direction

The next roadmap is no longer about proving placeholder surfaces. It is about making the product function more like a real resale app.

Near-term roadmap direction:

- QA and stabilization across all current flows
- first real provider foundation and first real provider integration
- real feed/search pagination and infinite-scroll friendly behavior
- database persistence for users, likes, preferences, and saved searches
- production-ready auth foundation
- saved user features such as persistent likes and saved searches
- stronger personalization built on real engagement data
- real analytics v1 based on observed pricing data
- alerts and watchlist foundations
- beta launch readiness and deployment hardening

ClosetSearch is not production-ready today. The current repo is best described as a solid foundation project that is ready for functional buildout.

## Product Summary

ClosetSearch should feel like a fashion-first resale browsing product:

- visual feed first
- strong search and filters
- normalized multi-provider listing model
- clean brand browsing
- careful, assistive personalization and pricing context
- cautious trust language that never overclaims authenticity certainty

See [PRODUCT.md](PRODUCT.md) for product scope and phased goals.

## Repository Structure

```text
closetsearch/
  README.md
  PRODUCT.md
  ARCHITECTURE.md
  TASKS.md
  DECISIONS.md
  apps/
    web/        React + Vite frontend
    api/        TypeScript API boundary
  packages/
    shared/     Shared domain types and small utilities
    providers/  Provider contracts and mock provider implementation
  docs/
    prompts/              AI development prompts and notes
    marketplace-notes/    Marketplace research notes
    runbooks/             Operational and development runbooks
  tests/       Cross-package or end-to-end tests when expanded
```

## Development Principles

- Work in small, reviewable passes.
- Keep provider-specific logic inside provider adapters.
- Keep the rest of the app dependent on normalized shared models.
- Verify each pass before moving to the next one.
- Do not overbuild premium analytics, AI, or fake-risk before core discovery and search are strong.
- Be explicit about what is real, what is mock, and what is placeholder.
- Prefer user-visible reliability and data quality over speculative systems.

## Getting Started

Read the core docs before making changes:

1. [PRODUCT.md](PRODUCT.md)
2. [ARCHITECTURE.md](ARCHITECTURE.md)
3. [TASKS.md](TASKS.md)
4. [ENGINEERING.md](ENGINEERING.md)
5. [DECISIONS.md](DECISIONS.md)

Install dependencies and run workspace checks:

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm build
corepack pnpm lint
corepack pnpm test
```

## Local Development

Run the frontend:

```sh
corepack pnpm dev:web
```

Run the API app:

```sh
corepack pnpm dev:api
```

Run both together:

```sh
corepack pnpm dev
```

## Current Limitations

Be careful not to overstate the current product state:

- provider data is mock-backed today
- user persistence is not yet database-backed
- auth is not yet production-grade
- analytics and fake-risk are foundation-only systems
- alerts and watchlists are still roadmap items
- deployment hardening and operational readiness still need dedicated work

## Next Planned Buildout

The next functional passes should focus on:

- stabilization and QA
- real provider runtime and first live provider integration
- pagination and repeated-search reliability
- persistence and auth hardening
- saved user features and improved personalization
- analytics v1 from observed pricing data
- alerts/watchlists and beta readiness

Use [TASKS.md](TASKS.md) for the step-by-step milestone roadmap.
