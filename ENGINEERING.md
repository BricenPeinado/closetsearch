# Engineering Standards

ClosetSearch should be built in small, reviewable passes. Each pass should make one boundary clearer or one milestone easier to implement.

## Baseline

- Use pnpm for workspace commands.
- Use TypeScript as the baseline language for apps and packages.
- Keep package boundaries explicit.
- Prefer small contracts over broad abstractions.

## Package Boundaries

- `packages/shared` owns normalized domain models and shared framework-independent contracts.
- `packages/providers` owns provider-facing contracts and no-network examples.
- `apps/web` will own user-facing UI once Milestone 2 starts.
- `apps/api` will own API orchestration once Milestone 2 starts.

Raw provider response shapes must not leave the provider layer. App and API code should consume normalized `Listing`, `SearchQuery`, and provider response types.

## Development Workflow

- Make one focused change at a time.
- Keep docs, tooling, contracts, and product features in separate passes when possible.
- Add dependencies only when a milestone needs them.
- Keep scripts honest: placeholders are acceptable before a runnable app exists.

## Deferred Systems

Do not build these before the core discovery/search experience is stable:

- authentication
- personalization
- likes/favorites behavior
- premium analytics
- fake-risk intelligence
- payments or subscriptions
- real provider integrations before the provider contract and mock flow are reviewable
