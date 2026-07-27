# Depop Integration Notes

## Status

The adapter, fixture payloads, normalization, pagination, resilience, capability
metadata, and contract tests are implemented. The operator has asserted
permission for this integration, but **authorized-live access remains
fail-closed** until a retained, non-secret provider-specific authorization
reference is supplied at deployment time.

The reviewed technical surface is the Depop web API origin. Public
reachability, fixture success, or a usable response is never treated as proof
of permission.

## Activation gate

All three values are required:

```sh
DEPOP_PROVIDER_ENABLED=true
DEPOP_SCRAPING_ALLOWED=true
DEPOP_AUTHORIZATION_REFERENCE=<retained-non-secret-reference>
```

The referenced record must describe the allowed hosts and endpoints, request
profile, deployment identities and regions, active/sold fields, seller data,
attribution, caching, retention/deletion, price history, analytics/ML use,
concurrency/rate limits, effective dates, and revocation contact.

## Implemented scope

- active and sold fixed-price discovery
- cursor pagination and bounded result counts
- brand, category, size, condition, status, price, currency, and supported sort
  forwarding
- exact original price/currency, shipping payer/cost when present, seller
  metadata, lifecycle timestamps, and relist linkage
- canonical brand resolution, validated listing/image destinations, mandatory
  marketplace attribution, and explicit analytics eligibility
- timeouts, minimum request spacing, bounded concurrency, jittered retries,
  `Retry-After` handling, circuit breaking, and malformed-item isolation

Depop is discovery-only. Checkout, messaging, offers, authentication, and
private account data are outside the integration.

## Prohibited behavior

- authentication, paywall, CAPTCHA, or access-control bypass
- logged-in/private data collection
- proxy or identity rotation intended to evade blocks
- increasing traffic beyond the retained authorization
- returning raw marketplace payloads to clients

## Disable and incident handling

Set either `DEPOP_PROVIDER_ENABLED` or `DEPOP_SCRAPING_ALLOWED` to `false`.
Production never falls back to fixtures or mock data. Disable immediately when
permission, schema, rate-limit, or data-handling scope becomes uncertain.
