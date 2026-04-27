# Shared Package

This package contains normalized domain models and small framework-independent contracts used across ClosetSearch apps and packages.

Current source of truth:

- `src/domain`: core product domain models
- `src/index.ts`: public type export surface
- `src/types.ts`: compatibility export surface for early imports

Keep this package focused on stable product concepts such as `Listing`, `SearchQuery`, and `Brand`.

Do not put these here:

- provider-specific raw response shapes
- app-specific UI props
- database logic
- analytics, fake-risk, or personalization models before those milestones begin
