# ClosetSearch

ClosetSearch is a fashion resale discovery platform. It helps users browse a visual home feed, search across resale listings, explore brands, and preview future personalization, analytics, and trust foundations through a normalized product experience.

The repository is intentionally documentation-led and milestone-based. Each pass is meant to stay reviewable, modular, and explicit about what is still placeholder-only.

## Current Status

ClosetSearch has progressed through these milestones:

- product and repo foundation
- app skeleton and tooling
- listing and provider foundations
- home feed foundation
- search experience foundation
- brand browsing foundation
- accounts and personalization foundation
- premium analytics foundation
- trust / fake-risk foundation placeholder

What the repo currently includes:

- a runnable React + Vite web app in apps/web
- a runnable TypeScript API app in `apps/api`
- normalized shared domain contracts in `packages/shared`
- a mock provider flow in `packages/providers`
- home feed, search, recent searches, and brand browsing flows
- lightweight signup, login, onboarding, likes, and profile flows
- simple signed-in personalization rules based on likes and preferences
- premium analytics placeholder surfaces and mock data
- trust / fake-risk placeholder signals with assistive wording only

What is still intentionally limited:

- listing data is still mock/test data
- real marketplace/provider integrations are not complete
- auth and persistence are still lightweight in-memory or browser-local foundation systems
- analytics are placeholder foundations only, not real market intelligence
- fake-risk is a placeholder trust foundation only, not real authenticity detection
- there is no database, billing, payment processing, or production auth/session stack

## Product Direction

The core product is still the resale discovery experience:

- the home feed is the primary surface
- search is first-class and separate from feed logic
- brand browsing is part of the core experience
- marketplace providers must be modular and normalize their data
- personalization, analytics, and trust signals remain carefully phased and assistive

See [PRODUCT.md](PRODUCT.md) for phased scope and non-goals.

## Repository Structure

```text
closetsearch/
  README.md
  PRODUCT.md
  ARCHITECTURE.md
  TASKS.md
  DECISIONS.md
  apps/
    web/        User-facing React + Vite app
    api/        TypeScript API boundary
  packages/
    shared/     Shared domain types and utilities
    providers/  Provider contracts and mock marketplace adapters
  docs/
    prompts/              AI development prompts and notes
    marketplace-notes/    Marketplace research notes
    runbooks/             Operational and development runbooks
  tests/       Cross-package or end-to-end tests when introduced
```

## Development Principles

- work in small, reviewable passes
- keep feed, search, providers, analytics, personalization, and trust concerns separated
- prefer normalized domain models over source-specific data leaking across the app
- treat analytics and trust as assistive placeholder systems until real data quality supports more
- avoid databases, production auth systems, and real provider integrations until the roadmap requires them

## Getting Started

Start by reading the core docs:

1. Read [PRODUCT.md](PRODUCT.md) to understand product scope and non-goals.
2. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing boundaries.
3. Use [TASKS.md](TASKS.md) to choose the next milestone pass.
4. Follow [ENGINEERING.md](ENGINEERING.md) for workspace and standards guidance.
5. Record durable choices in [DECISIONS.md](DECISIONS.md).

Install dependencies and run the workspace checks:

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm build
corepack pnpm lint
corepack pnpm test
```

## Local Development

Run the web app:

```sh
corepack pnpm dev:web
```

Run the API app:

```sh
corepack pnpm dev:api
```

Run both workspace apps in parallel:

```sh
corepack pnpm dev
```

## Next Planned Work

Near-term follow-up work is expected to focus on:

- UI design polish and consistency
- broader QA and testing coverage
- reliability hardening around core flows
- real data/provider integration after the mock foundation is stable

That means the repo is meaningfully beyond the initial shell stage, but it is still a foundation project rather than a production-ready marketplace product.
