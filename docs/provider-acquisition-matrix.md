# Provider Acquisition Matrix

Research date: 2026-07-24. Links are primary marketplace/developer sources.
An implementation or fixture is not authorization. `Authorization status`
describes evidence present in this repository, not an operator's private
correspondence.

| Source | Official/partner path and authentication | Permitted data/use, restrictions, robots, attribution | Limits and pagination | Active/sold/change support | Authorization status |
| --- | --- | --- | --- | --- | --- |
| Grailed | No documented public discovery API was found. The current adapter extracts HTML/JavaScript Algolia credentials and calls undocumented indexes. | [Terms](https://www.grailed.com/about/terms) prohibit automated extraction, reverse engineering, third-party tools without prior written consent, and ignoring robots; [robots.txt](https://www.grailed.com/robots.txt) restricts search/sold paths. Written consent must explicitly cover this request profile, stored fields, retention, analytics/ML, attribution, limits, and deployment identities. | Repo pacing is not a marketplace grant. Page-based Algolia behavior is implementation-inferred. | Adapter infers active and sold indexes; no documented webhook/change feed. | **Blocked.** A boolean flag is present, but no authorization artifact/reference exists. Fixtures remain allowed for tests; live access must fail closed without a retained consent reference. |
| eBay | Official [Browse API](https://developer.ebay.com/api-docs/buy/api-browse.html) uses an OAuth application token from client credentials. Production Buy APIs require [partner eligibility and agreements](https://developer.ebay.com/api-docs/buy/buy-requirements.html). | Follow eBay Buy API display/data requirements and affiliate attribution; use the returned affiliate URL when enrolled. Do not scrape when the API is the supported path. | Default Browse quota is documented in [API call limits](https://developer.ebay.com/develop/get-started/api-call-limits); native `limit`/`offset` pagination. Honor response rate data and `Retry-After`. | Active purchasable listings are supported. Restricted Marketplace Insights is not open general sold access. [Feed guidance](https://developer.ebay.com/develop/guides-v2/inventory-discovery-and-refresh-guide) and approved notification capabilities can refresh price/availability. | **Blocked for live use.** Best next adapter; no client credentials, partner approval, affiliate campaign, or production authorization is configured. |
| Etsy | Official Open API v3. Every request needs an app key; scoped/private operations use OAuth 2.0. Personal Apps require approval and broader use needs [Commercial Access](https://developers.etsy.com/). | [API terms](https://www.etsy.com/legal/api/) govern caching, display, trademarks, and prohibit scraping. Persistent history and analytics/ML require an approved use case; public display must meet freshness and attribution rules. | Application QPS/QPD limits are returned in headers; [rate-limit docs](https://developers.etsy.com/documentation/essentials/rate-limits/) require honoring 429/`Retry-After`. Active search uses `limit`/`offset`. | General active listings are available within access level. Broad sold history is not public; shop sold-out data is scoped. [Webhooks](https://developers.etsy.com/documentation/essentials/webhooks/) cover order events, not a general listing change feed. | **Blocked.** No app key, reviewed application, Commercial Access, or written analytics/retention approval exists. |
| Depop | Private seller [Partner/Selling API](https://partnerapi.depop.com/api-docs/reference/) with API key or OAuth authorization-code/PKCE after business approval. | Seller-scoped inventory/order integration is not authorization for marketplace-wide buyer discovery, retention, or ML. | List pagination supports bounded pages (documented maximum 100). | The connected seller's selling/sold state, orders, and item webhooks are supported. No public marketplace discovery scope. | **Blocked/unsupported for discovery.** Requires a separate partner agreement granting aggregation and historical use. |
| StockX | Reviewed developer access, OAuth 2.0, and seller/catalog APIs; see [getting started](https://developer.stockx.com/portal/getting-started) and [API reference](https://developer.stockx.com/portal/api-reference). | The published [license](https://developer.stockx.com/portal/license-agreement) limits data to authorized/internal uses and restricts commercial reuse, archival, and disclosure absent another agreement. | Published baseline: 25,000 calls/day and one request/second; catalog uses page number/page size. | Catalog market aggregates are available; individual listings/orders are authenticated-seller data. | **Blocked/unsuitable without a negotiated public-display, retention, and ML license.** |
| Vinted | Allowlisted Vinted Pro Integrations API uses access key plus HMAC; [official docs](https://pro-docs.svc.vinted.com/). | Seller-inventory integration is not marketplace discovery. Public terms/robots restrict unapproved automation and reserve dataset/ML rights. | Seller inventory uses an `after_item_id` continuation and account item limits. | Connected business item/order webhooks and sold orders only. | **Blocked/unsupported for discovery.** Requires a marketplace data partnership beyond Pro access. |
| Poshmark | No official public listing-discovery API was found. | [Terms](https://www.poshmark.com/terms) prohibit scraping, crawling, harvesting, automated collection, reverse engineering, and unapproved reuse. | None lawfully available without a negotiated feed. | No documented public active/sold/change feed. | **Blocked.** Do not build or enable scraping without written partner permission. |
| Mercari US | No official public listing-discovery API was found. | [Prohibited conduct](https://www.mercari.com/us/help_center/topics/listing/policies/prohibited-conduct/) and platform terms prohibit unprovided automated interfaces and automated gathering/copying. | None lawfully available without a negotiated feed. | No documented public active/sold/change feed. | **Blocked.** Do not build or enable scraping without a documented partner feed. |
| Vestiaire Collective | Public material describes brand/retailer [Resale-as-a-Service partnerships](https://us.vestiairecollective.com/journal/raas-brand-partner-x-vestiaire-collective/), but no public discovery API specification was found. | [Website terms](https://faq.vestiairecollective.com/hc/en-us/articles/8996751206929-Website-Terms-of-Use) prohibit unconsented scraping/extraction. Negotiate display, retention, attribution, active/sold coverage, ML, update cadence, and limits. | Contract-dependent. | Contract-dependent data feed/change support. | **Blocked.** Partnership/data-feed approval is absent. |

## Acquisition order

1. Apply for eBay Buy API production access and affiliate attribution, then
   activate the fixture-complete Browse adapter with official credentials.
2. Apply for Etsy access only if Etsy approves ClosetSearch's aggregation,
   persistence, price-history, and analytics/ML use; otherwise limit or disable it.
3. Negotiate a Vestiaire data partnership.
4. Keep every other discovery source disabled until the exact rights above are
   documented.

## Required authorization record

Before any non-official scraping or restricted provider can become active, store
an operator-supplied reference (not the confidential agreement itself) that
identifies:

- provider and approving party
- effective/expiry dates and revocation contact
- approved hosts, endpoints, access method, deployment identities, and regions
- permitted fields, active/sold coverage, retention, derived analytics, and ML use
- rate/concurrency limits, attribution, caching, deletion, and audit duties

Startup must reject an enabled provider when this reference or required official
credentials are absent. Tests and CI use recorded, redacted fixtures only and
must never contact live marketplaces.
