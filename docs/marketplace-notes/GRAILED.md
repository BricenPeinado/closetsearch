# Grailed Integration Notes

## Status

The adapter, fixtures, normalization, pagination, credential refresh, resilience,
and contract tests are implemented. The operator has asserted permission for
this integration, but **authorized-live access remains fail-closed** because no
retained, non-secret provider-specific authorization reference is configured.

The current approach reads public-page configuration and accesses undocumented
Algolia indexes. Grailed terms/robots considerations are recorded in the
[provider acquisition matrix](../provider-acquisition-matrix.md). Technical
reachability is not permission.

## Activation gate

Both must be present:

```sh
GRAILED_SCRAPING_ALLOWED=true
GRAILED_AUTHORIZATION_REFERENCE=<retained-non-secret-reference>
```

The underlying written approval must cover hosts/endpoints, request profile,
deployment identities/regions, active/sold fields, seller data, attribution,
caching, retention/deletion, price history, analytics/ML, concurrency/rate
limits, dates, and revocation contact.

Keep `GRAILED_PROVIDER_ENABLED=false` until that record exists. Review
permission/terms/robots changes continuously and disable immediately if scope is
uncertain.

## Prohibited behavior

- authentication/paywall/CAPTCHA/access-control bypass
- logged-in/private data collection
- identity/proxy rotation or browser automation to evade blocks
- increasing request volume beyond written limits
- treating public JavaScript credentials as an authorization grant
- returning raw HTML/Algolia payloads to clients

## Normalized scope

Fixture tests cover stable listing identity, validated URLs/images, exact
price/currency, active/sold state, category/size/condition/type, optional seller
metadata, timestamps, attribution, analytics exclusion, and page continuation.

Default technical guardrails include a 5-second timeout, 3-second minimum
request interval, concurrency `2`, two retries with a 250 ms base backoff, a
60-second maximum honored `Retry-After`, a five-failure circuit threshold with
a 30-second cooldown, and a 24-result normalization cap. One persistent client
per provider instance keeps pacing/concurrency/circuit state across searches.
Written limits always override defaults.

Authorized-live construction accepts only the canonical
`https://www.grailed.com` origin. Script credential discovery is restricted to
that exact HTTPS origin, Algolia application IDs are validated before hostname
construction, and redirects are not followed implicitly. A hostile page value
therefore cannot turn the adapter into an arbitrary/private-host request.

## Disable and incident handling

Set either provider enabled or scraping allowed to false. In production, return
explicit partial/unavailable state; never fall back to mock. Do not introduce a
proxy to conceal a provider block.
