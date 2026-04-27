# Packages

This folder contains reusable TypeScript packages shared across ClosetSearch apps.

Current packages:

- `shared`: normalized domain models and shared framework-independent contracts
- `providers`: provider-facing contracts and example adapters

Package boundaries should stay small. App-specific UI belongs in `apps/web`; API orchestration belongs in `apps/api`; raw marketplace shapes should stay inside provider adapters.
