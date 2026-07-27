# Mercari Japan Integration Notes

## Status

The adapter, Japanese fixture payloads, normalization, pagination, resilience,
capability metadata, and contract tests are implemented. The operator has
asserted permission for this integration, but **authorized-live access remains
fail-closed** until a retained, non-secret provider-specific authorization
reference is supplied at deployment time.

## Activation gate

All three values are required:

```sh
MERCARI_JP_PROVIDER_ENABLED=true
MERCARI_JP_SCRAPING_ALLOWED=true
MERCARI_JP_AUTHORIZATION_REFERENCE=<retained-non-secret-reference>
```

The referenced record must cover the reviewed Mercari Japan origins, request
profile, deployment identity/region, active/sold and seller fields,
attribution, caching, retention/deletion, translation, analytics/ML use,
concurrency/rate limits, dates, and revocation contact.

## Implemented scope

- active and sold fixed-price discovery
- cursor pagination, bounded result counts, Japanese brand aliases, filters,
  and supported native sorting
- exact original JPY price, shipping payer/method, seller metadata, lifecycle
  timestamps, and relist linkage
- original Japanese title/description plus separately labeled translated text
  when the provider payload supplies it
- canonical brand resolution, validated destinations/images, mandatory
  attribution, and explicit analytics eligibility
- domestic-shipping and proxy-purchase limitation metadata
- timeouts, minimum request spacing, bounded concurrency, jittered retries,
  `Retry-After` handling, circuit breaking, and malformed-item isolation

ClosetSearch is discovery-only. It is not the seller, purchasing proxy, or
importer, and it does not perform checkout or messaging. Domestic-only listings
carry a clear notice that an independent proxy service may be required.

## Prohibited behavior

- authentication, paywall, CAPTCHA, or access-control bypass
- checkout, messaging, or private account access
- proxy or identity rotation intended to evade blocks
- presenting translated text as the marketplace's original text
- hiding domestic-only or proxy-purchase limitations

## Disable and incident handling

Set either `MERCARI_JP_PROVIDER_ENABLED` or
`MERCARI_JP_SCRAPING_ALLOWED` to `false`. Production never falls back to
fixtures or mock data. Disable immediately if authorization, schema, or
traffic/data-handling scope becomes uncertain.
