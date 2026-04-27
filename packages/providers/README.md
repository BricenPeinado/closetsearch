# Providers Package

This package contains provider-facing contracts and examples.

Current source of truth:

- `src/types.ts`: provider adapter contract
- `src/index.ts`: public export surface
- `src/examples`: no-network examples that demonstrate the contract shape

Provider implementations must accept normalized shared `SearchQuery` input and return normalized shared `Listing` objects through the provider response wrapper.

Do not put these here yet:

- real marketplace integrations
- network clients
- provider registry or plugin system
- API orchestration logic
