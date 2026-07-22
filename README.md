# ClosetSearch

ClosetSearch is a fashion resale discovery app. The goal is to help users browse a visual feed, search across resale listings, explore brands, save interesting pieces, and eventually benefit from lightweight personalization and pricing context without turning the product into a noisy dashboard.

The repo is documentation-led and milestone-based. Foundation work is already in place, and the project is now moving from placeholder architecture into real-data and productization passes.

## Current Status

ClosetSearch has completed its initial foundation milestones, auth hardening, a focused saved-user-features pass, a rules-based Personalization V2 feed pass, a first observed-data analytics pass, an alert-ready watchlist foundation, a constrained beta-readiness pass, a beta stability hardening pass, and a launch-candidate hardening pass. The repo can now produce a constrained preview release candidate, not a full public production launch.

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
- signup, login, onboarding, and cookie-backed auth/session foundations
- a useful signed-in profile with persistent likes, saved searches, saved filters, alert-ready watchlists, notification preference shell controls, and basic user settings
- watchlists for watched brands, searches, price ranges, optional marketplace/listing-type criteria, and enable or pause state
- an alert matching foundation with stored candidate-match data and a pure watchlist-to-listing matcher for future delivery work
- local SQLite-backed persistence for users, onboarding preferences, likes, saved-user data, recent searches, saved searches, and listing cache
- explainable rules-based signed-in personalization using likes, onboarding preferences, saved searches, saved filters, watchlists, preferred sources, freshness, and diversity balancing
- observed-data premium analytics with price snapshots, brand/category pricing ranges, and cautious under-market signals
- trust / fake-risk placeholder signals with careful assistive wording
- deployment, environment, seed/demo, QA, limitation, privacy/data-use, feedback, and triage docs for constrained beta operation
- safer network/provider error states, explicit session-expiry recovery copy, and more honest provider-limited UI messaging for real beta testers

What is still placeholder, mock, or intentionally lightweight:

- listing data is still mock/test data
- real marketplace provider integrations are not complete
- auth now uses cookie-backed server sessions, slow password hashing, and protected API routes, but OAuth, email verification, and password reset are still deferred
- persistence is now a local SQLite foundation inside the API, not a production-grade database stack yet
- analytics are now simple observed pricing context, not forecasting or full resale intelligence
- fake-risk is a trust placeholder, not real authenticity detection
- there is no production-ready billing, subscriptions, watchlist alert delivery, machine-learning recommendations, or deployment hardening yet
- email, push, and SMS alert delivery are intentionally inactive; notification preferences are a saved shell only for now
- operational logging and launch docs are intentionally lightweight and repo-centric rather than full production observability

## Roadmap Direction

The next roadmap is no longer about proving placeholder surfaces. It is about making the product function more like a real resale app.

Near-term roadmap direction:

- QA and stabilization across all current flows
- first real provider foundation and first real provider integration
- real feed/search pagination and infinite-scroll friendly behavior
- production-ready auth foundation
- deeper recommendation and analytics work beyond the current explainable rules-based personalization layer
- deeper analytics beyond the current observed-data pricing context layer
- watchlist alerts and notifications beyond the current saved shell/data foundation
- beta launch readiness and deployment hardening

ClosetSearch is not production-ready today. The current repo is best described as a constrained preview launch candidate with honest docs, repeatable smoke checks, and explicit release/rollback guidance for a small tester-facing deployment.

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
corepack pnpm db:migrate
corepack pnpm db:seed
```

## Beta Readiness Docs

- [Docs index](docs/README.md)
- [Deployment checklist](docs/runbooks/deployment-checklist.md)
- [Environment reference](docs/runbooks/environment.md)
- [Seed and demo data](docs/runbooks/seed-demo-data.md)
- [Manual beta QA checklist](docs/qa/manual-beta-checklist.md)
- [Known limitations](docs/known-limitations.md)
- [Beta feedback plan](docs/beta-feedback-plan.md)
- [Beta privacy copy](docs/legal/privacy-beta.md)
- [Beta data-use copy](docs/legal/data-use.md)

## Beta Testing

- [Manual beta QA checklist](docs/qa/manual-beta-checklist.md)
- [Known limitations](docs/known-limitations.md)
- [Beta triage rubric](docs/beta-triage-rubric.md)
- [Beta bug report template](docs/templates/beta-bug-report.md)
- [Beta feature request template](docs/templates/beta-feature-request.md)
- [Beta usability feedback template](docs/templates/beta-usability-feedback.md)
- [Post-beta priorities](docs/post-beta-priorities.md)

## Release Candidate Docs

- [Launch candidate scope freeze](docs/release/scope-freeze.md)
- [Release candidate checklist](docs/release/release-candidate-checklist.md)
- [Launch go / no-go criteria](docs/release/go-no-go.md)
- [Rollback plan](docs/release/rollback-plan.md)
- [Launch blockers](docs/release/launch-blockers.md)
- [Post-launch monitoring](docs/release/post-launch-monitoring.md)
- [Release notes template](docs/release/release-notes-template.md)
- Smoke test command: `corepack pnpm smoke:test`

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

- provider coverage is still limited and may run in mock or authorized Grailed mode depending on runtime configuration
- persistence is local SQLite only and not a production-ready database deployment
- auth now has a production-auth foundation, but OAuth, email verification, password reset, and advanced account recovery are still not implemented
- analytics are observed-data only and intentionally avoid forecasting, investment language, or guaranteed underpriced claims
- fake-risk remains a foundation-only trust system
- watchlists are now alert-ready saved intent, but no email, push, SMS, or background monitoring is active yet
- this repo is ready for a constrained preview release candidate, not a full public production launch
- deployment, rollback, and smoke-test guidance now exist, but production-scale operations still need dedicated work

## Next Planned Buildout

The next functional passes should focus on:

- stabilization and QA
- real provider runtime and first live provider integration
- pagination and repeated-search reliability
- persistence and auth hardening
- improved personalization on top of saved-user behavior
- analytics v1 from observed pricing data
- watchlist delivery, alerts, and beta readiness

Use [TASKS.md](TASKS.md) for the step-by-step milestone roadmap.
