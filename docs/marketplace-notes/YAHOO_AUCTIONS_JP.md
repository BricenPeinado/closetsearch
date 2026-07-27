# Yahoo! Auctions Japan Integration Notes

## Status

The adapter, Japanese fixture payloads, normalization, auction semantics,
pagination, resilience, capability metadata, and contract tests are
implemented. The operator has asserted permission for this integration, but
**authorized-live access remains fail-closed** until a retained, non-secret
provider-specific authorization reference is supplied at deployment time.

## Activation gate

All three values are required:

```sh
YAHOO_AUCTIONS_JP_PROVIDER_ENABLED=true
YAHOO_AUCTIONS_JP_SCRAPING_ALLOWED=true
YAHOO_AUCTIONS_JP_AUTHORIZATION_REFERENCE=<retained-non-secret-reference>
```

The referenced record must cover the reviewed Yahoo! Auctions Japan origins,
request profile, deployment identity/region, auction and sold fields,
attribution, caching, retention/deletion, translation, analytics/ML use,
concurrency/rate limits, dates, and revocation contact.

## Implemented scope

- active and confirmed-sold auction or fixed-price discovery
- page pagination, bounded result counts, Japanese brand aliases, filters, and
  native sorting including ending soon and bid popularity
- exact JPY current bid, buy-now price, confirmed completed price, bid count,
  and auction end time
- original Japanese title/description plus separately labeled translated text
  when the provider payload supplies it
- shipping payer/cost, seller feedback, lifecycle/relist linkage, validated
  destinations/images, and required attribution
- explicit analytics exclusion until an auction outcome is confirmed
- timeouts, minimum request spacing, bounded concurrency, jittered retries,
  `Retry-After` handling, circuit breaking, and malformed-item isolation

ClosetSearch is discovery-only. It is not the seller, auction agent, purchasing
proxy, or importer. Listings that appear domestic-only carry a proxy/shipping
limitation notice; ClosetSearch does not select or endorse a proxy service.

## Prohibited behavior

- authentication, paywall, CAPTCHA, or access-control bypass
- bidding, checkout, messaging, or private account access
- proxy or identity rotation intended to evade blocks
- inferring a sold price from an unconfirmed ended auction
- presenting translated text as the marketplace's original text

## Disable and incident handling

Set either `YAHOO_AUCTIONS_JP_PROVIDER_ENABLED` or
`YAHOO_AUCTIONS_JP_SCRAPING_ALLOWED` to `false`. Production never falls back to
fixtures or mock data. Disable immediately if authorization, schema, auction
outcomes, or traffic limits become uncertain.
