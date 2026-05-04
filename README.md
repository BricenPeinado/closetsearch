# ClosetSearch

ClosetSearch is a fashion resale discovery platform. It helps users browse a visual home feed, search across clothing resale marketplaces, and discover brands through a normalized product experience.

The repository is intentionally small and documentation-led. The goal is to make each development pass clear enough for an engineer or AI coding agent to implement without guessing at product scope.

## Current Status

ClosetSearch is in Milestone 2: app skeleton and tooling.

The repo currently contains:

- root product and architecture docs
- a runnable web app shell in `apps/web`
- a runnable API app shell in `apps/api`
- starter shared TypeScript contracts
- starter provider package structure
- pnpm workspace configuration
- workspace TypeScript, lint, build, and test commands

It does not contain real provider integrations, auth, analytics logic, payments, database systems, or AI systems yet.

## Product Direction

The core product is a resale discovery experience:

- The home feed is the primary surface.
- Search is first-class and separate from feed logic.
- Brand browsing is part of the core experience.
- Marketplace providers must be modular and normalize their data.
- Premium analytics and fake-risk intelligence are planned future areas, but they are not part of the initial build.

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
    web/        User-facing React + Vite app shell
    api/        TypeScript API shell
  packages/
    shared/     Shared domain types and utilities
    providers/  Provider contracts and marketplace adapters
  docs/
    prompts/              AI development prompts and notes
    marketplace-notes/    Marketplace research notes
    runbooks/             Operational and development runbooks
  tests/       Cross-package or end-to-end tests when introduced
```

## Development Principles

- Work in small, reviewable passes.
- Keep feed, search, providers, and future intelligence systems separated.
- Prefer normalized domain models over source-specific data leaking across the app.
- Do not add auth, favorites, analytics, payments, or fake-risk systems before the core discovery/search experience is stable.
- Add tooling and dependencies only when a milestone needs them.

## Getting Started

Start by reading the core docs:

1. Read [PRODUCT.md](PRODUCT.md) to understand what V1 includes and excludes.
2. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing code boundaries.
3. Use [TASKS.md](TASKS.md) to choose the next focused pass.
4. Follow [ENGINEERING.md](ENGINEERING.md) for workspace and boundary standards.
5. Record durable choices in [DECISIONS.md](DECISIONS.md).

Install dependencies with pnpm before running workspace scripts:

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
