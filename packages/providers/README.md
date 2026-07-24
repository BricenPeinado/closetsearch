# Providers Package

`@closetsearch/providers` owns the marketplace contract and every raw provider
shape.

Implemented adapters:

- deterministic mock fixtures for local/test use
- eBay Browse official API adapter (active inventory only)
- Grailed fixture/live-capable adapter gated by explicit written authorization

Shared resilient HTTP support covers pacing, bounded concurrency, timeout,
`Retry-After`, exponential retry, and circuit behavior. Adapters normalize
identity, URLs/images, exact prices, marketplace metadata, lifecycle,
seller/shipping data when supported, attribution, analytics eligibility,
capabilities, native pagination, latency/freshness, and terminal/retryable
errors.

Provider fixtures and contract tests never prove live authorization. Normal CI
must not call marketplaces. See the
[provider acquisition matrix](../../docs/provider-acquisition-matrix.md).

Raw eBay/Grailed types must not be exported into API or web product contracts.
