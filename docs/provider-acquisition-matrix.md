# Provider Acquisition Matrix

Research reviewed: 2026-07-26. Links point to primary marketplace/developer
sources. Code, fixtures, public reachability, and an operator assertion are not
deployment credentials. `Authorization status` records what can be proven from
this checkout and its deployment configuration.

## Product marketplaces

| Source                | Reviewed access path                                                                                                                                                                                                                                                                                                  | Implemented data scope                                                                                                                                                                                                                                             | Runtime limits and safeguards                                                                                                                                                                                 | Authorization status                                                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| eBay                  | Official [Browse API](https://developer.ebay.com/api-docs/buy/api-browse.html) with OAuth client credentials. Production Buy APIs require [eligibility and agreements](https://developer.ebay.com/api-docs/buy/buy-requirements.html).                                                                                | Active fixed-price/auction discovery, official pagination, exact source currency, seller/shipping/auction metadata when returned, and affiliate-ready destination attribution. Broad sold history is not inferred from Browse data.                                | Native limit/offset pagination, bounded concurrency/results, timeouts, paced jittered retries, `Retry-After`, circuit breaking, token refresh, canonical production origins, and locale/marketplace headers.  | **Implemented and fixture-verified; live blocked.** Missing production client ID/secret, Buy API approval evidence, and `EBAY_AUTHORIZATION_REFERENCE`; affiliate campaign/reference IDs are also absent if monetized links are required.                                  |
| Grailed               | No documented public discovery API was found. The reviewed adapter uses a public-page configuration value and undocumented Algolia indexes only under written permission. [Terms](https://www.grailed.com/about/terms) and [robots](https://www.grailed.com/robots.txt) remain an independent continuous-review gate. | Active/sold fixed-price discovery, page pagination, exact source currency, seller/shipping/lifecycle metadata, and required attribution.                                                                                                                           | Canonical HTTPS origins, credential/host validation, no redirects, bounded results/concurrency, minimum spacing, timeouts, jittered retries, `Retry-After`, circuit breaking, and fixture-only CI.            | **Implemented and fixture-verified; live blocked.** The operator asserted permission in the implementation brief, but no durable `GRAILED_AUTHORIZATION_REFERENCE` is configured. `GRAILED_SCRAPING_ALLOWED` is an additional fail-closed switch, not proof of permission. |
| Depop                 | Reviewed Depop web API surface under provider-specific written authorization. The public [Partner/Selling API](https://partnerapi.depop.com/api-docs/reference/) is seller-scoped and is not by itself marketplace-wide discovery permission.                                                                         | Active/sold fixed-price discovery, cursor pagination, exact source currency, seller/shipping/lifecycle metadata, filters/sorts, and required attribution.                                                                                                          | Reviewed HTTPS origins, bounded results/concurrency, minimum spacing, timeouts, jittered retries, `Retry-After`, circuit breaking, malformed-record isolation, and fixture-only CI.                           | **Implemented and fixture-verified; live blocked.** The operator asserted permission, but no durable `DEPOP_AUTHORIZATION_REFERENCE` is configured. `DEPOP_SCRAPING_ALLOWED` remains required.                                                                             |
| Yahoo! Auctions Japan | Reviewed `auctions.yahoo.co.jp` discovery surface under provider-specific written authorization. Marketplace checkout and bidding remain exclusively on Yahoo! Auctions Japan; see its [transaction guide](https://auctions.yahoo.co.jp/guide/guide/bid03.html).                                                      | Active auctions/fixed-price listings and confirmed sold outcomes; page pagination; exact JPY bid/buy-now/completed amounts; bid count/end time; Japanese original and separately labeled translated text; seller/shipping/proxy limitations; required attribution. | Exact reviewed HTTPS origins/image hosts, bounded results/concurrency, minimum spacing, timeouts, jittered retries, `Retry-After`, circuit breaking, confirmed-outcome analytics gating, and fixture-only CI. | **Implemented and fixture-verified; live blocked.** The operator asserted permission, but no durable `YAHOO_AUCTIONS_JP_AUTHORIZATION_REFERENCE` is configured. `YAHOO_AUCTIONS_JP_SCRAPING_ALLOWED` remains required.                                                     |
| Mercari Japan         | Reviewed Mercari Japan discovery surface under provider-specific written authorization. Account-authorized third-party access is separately user-controlled in Mercari's [access guidance](https://help.jp.mercari.com/guide/articles/596/); ClosetSearch does not request private account access.                    | Active/sold fixed-price discovery, cursor pagination, exact JPY price, Japanese original and separately labeled translated text, seller/shipping/proxy limitations, lifecycle metadata, filters/sorts, and required attribution.                                   | Exact reviewed HTTPS origins/image hosts, bounded results/concurrency, minimum spacing, timeouts, jittered retries, `Retry-After`, circuit breaking, malformed-record isolation, and fixture-only CI.         | **Implemented and fixture-verified; live blocked.** The operator asserted permission, but no durable `MERCARI_JP_AUTHORIZATION_REFERENCE` is configured. `MERCARI_JP_SCRAPING_ALLOWED` remains required.                                                                   |

All five adapters are discovery-only. ClosetSearch does not authenticate to a
shopper's marketplace account, bid, buy, message a seller, bypass a CAPTCHA or
access control, rotate identities to evade blocking, or conceal domestic-only
shipping/proxy limitations.

## Secondary candidates

These sources are not part of the current five-marketplace product. They remain
disabled until a separate product decision and the stated access evidence
exist.

| Source               | Official or partner path                                                                                                                                         | Current disposition                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Etsy                 | Official Open API v3; broader use may require [Commercial Access](https://developers.etsy.com/) and is governed by [API terms](https://www.etsy.com/legal/api/). | No adapter in the active product. Missing app approval, credentials, and explicit aggregation/history/ML scope. |
| StockX               | Reviewed developer access and OAuth; see [getting started](https://developer.stockx.com/portal/getting-started).                                                 | No adapter in the active product. Public display, retention, and analytics rights are not established.          |
| Vinted               | Allowlisted Vinted Pro Integrations API; see [official docs](https://pro-docs.svc.vinted.com/).                                                                  | Seller inventory is not marketplace-wide discovery. No active-product adapter.                                  |
| Poshmark             | No official public listing-discovery API identified.                                                                                                             | Do not implement or enable collection without a negotiated feed and retained authorization record.              |
| Mercari US           | No official public listing-discovery API identified.                                                                                                             | Separate from Mercari Japan; do not implement or enable collection without a negotiated feed.                   |
| Vestiaire Collective | Public material describes [Resale-as-a-Service partnerships](https://us.vestiairecollective.com/journal/raas-brand-partner-x-vestiaire-collective/).             | No active-product adapter; a display/retention/ML data agreement is absent.                                     |

## Activation order

1. Supply and validate eBay production credentials, Buy API approval, and a
   non-secret authorization reference; enable one production marketplace at a
   time.
2. Store one durable authorization reference for each of Grailed, Depop, Yahoo!
   Auctions Japan, and Mercari Japan, then confirm the corresponding permission
   still covers the exact adapter request profile.
3. Run fixture/contract suites, production startup validation, and the explicit
   staging live smoke (`LIVE_PROVIDER_SMOKE_TESTS=true`) with mock fallback
   disabled.
4. Confirm provider health, redacted metrics, data quality, attribution,
   deletion/retention duties, and a tested kill switch before increasing
   traffic.

## Required authorization record

Before any provider can become active, retain an operator-supplied reference
(not the confidential agreement or credential itself) that identifies:

- provider, approving party, and internal owner
- effective/expiry dates and revocation contact
- approved hosts, endpoints, access method, deployment identities, and regions
- permitted fields, active/sold coverage, translation, retention, derived
  analytics, and ML use
- rate/concurrency limits, attribution, caching, deletion, audit, and incident
  duties

Production startup rejects an enabled provider when this reference, an explicit
scraping switch where applicable, or required official credentials are absent.
Tests and CI use recorded, redacted fixtures only and never contact live
marketplaces. Live smoke tests require an explicit operator flag and staging
secrets.
