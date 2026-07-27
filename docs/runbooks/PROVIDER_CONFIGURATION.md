# Provider Configuration

## Runtime modes

- `mock`: deterministic fixture inventory for local/test use
- `hybrid`: explicit non-production development mode that may show fixtures
  beside configured real adapters
- `real`: real providers only

Production startup requires:

```sh
PROVIDER_RUNTIME_MODE=real
PROVIDER_ALLOW_MOCK_FALLBACK=false
PROVIDER_MOCK_ENABLED=false
```

Production also requires at least one active real provider for readiness. A
provider can be implemented yet inactive because its credentials or
authorization proof are absent.

## Core variables

| Variable                        | Default                           | Bounds/notes                       |
| ------------------------------- | --------------------------------- | ---------------------------------- |
| `PROVIDER_RUNTIME_MODE`         | mock locally, real in production  | `mock`, `hybrid`, `real`           |
| `PROVIDER_ALLOW_MOCK_FALLBACK`  | true locally, false in production | production cannot override to true |
| `PROVIDER_MOCK_ENABLED`         | true locally, false in production | fixture source only                |
| `PROVIDER_REQUEST_TIMEOUT_MS`   | `10000`                           | 1000–60000                         |
| `PROVIDER_MAX_ACTIVE_PROVIDERS` | `5`                               | 1–5                                |

## eBay official API

| Variable                       | Default                | Purpose                       |
| ------------------------------ | ---------------------- | ----------------------------- |
| `EBAY_PROVIDER_ENABLED`        | `false`                | explicit enable               |
| `EBAY_AUTHORIZATION_REFERENCE` | none                   | non-secret approval reference |
| `EBAY_CLIENT_ID`               | none                   | secret application ID         |
| `EBAY_CLIENT_SECRET`           | none                   | secret application credential |
| `EBAY_API_BASE_URL`            | `https://api.ebay.com` | Browse origin                 |
| `EBAY_IDENTITY_BASE_URL`       | `https://api.ebay.com` | OAuth origin                  |
| `EBAY_MARKETPLACE_ID`          | `EBAY_US`              | marketplace header            |
| `EBAY_LOCALE`                  | `en-US`                | content-language header       |
| `EBAY_OAUTH_SCOPE`             | Browse API scope       | approved scope                |
| `EBAY_AFFILIATE_CAMPAIGN_ID`   | none                   | approved campaign attribution |
| `EBAY_AFFILIATE_REFERENCE_ID`  | none                   | optional reference            |
| `EBAY_REQUEST_TIMEOUT_MS`      | `8000`                 | bounded timeout               |
| `EBAY_MIN_REQUEST_INTERVAL_MS` | `250`                  | pacing                        |
| `EBAY_MAX_CONCURRENCY`         | `2`                    | 1–10                          |
| `EBAY_MAX_RETRIES`             | `2`                    | 0–5                           |

Both credentials and a non-secret authorization reference are required for
activation, but credentials alone do not prove production Buy API partner
eligibility or permitted ClosetSearch use. Keep credentials in secret
management and do not echo them through health output.
`EBAY_API_BASE_URL` and `EBAY_IDENTITY_BASE_URL` accept only the canonical eBay
production or sandbox HTTPS origins; arbitrary paths, credentials-in-URL,
queries, fragments, and other hosts fail startup/provider construction.

## Grailed authorized scraping

| Variable                                    | Default                    | Purpose                                          |
| ------------------------------------------- | -------------------------- | ------------------------------------------------ |
| `GRAILED_PROVIDER_ENABLED`                  | follows authorization flag | explicit enable/disable                          |
| `GRAILED_SCRAPING_ALLOWED`                  | `false`                    | operator compliance assertion                    |
| `GRAILED_AUTHORIZATION_REFERENCE`           | none                       | retained non-secret written-permission reference |
| `GRAILED_BASE_URL`                          | `https://www.grailed.com`  | approved origin                                  |
| `GRAILED_REQUEST_TIMEOUT_MS`                | `5000`                     | bounded timeout                                  |
| `GRAILED_MIN_REQUEST_INTERVAL_MS`           | `3000`                     | pacing, not authorization                        |
| `GRAILED_MAX_CONCURRENCY`                   | `2`                        | 1–10                                             |
| `GRAILED_MAX_RETRIES`                       | `2`                        | 0–5                                              |
| `GRAILED_BASE_BACKOFF_MS`                   | `250`                      | 0–10000                                          |
| `GRAILED_MAX_RETRY_AFTER_MS`                | `60000`                    | 0–300000                                         |
| `GRAILED_CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5`                        | 1–20                                             |
| `GRAILED_CIRCUIT_BREAKER_COOLDOWN_MS`       | `30000`                    | 1000–300000                                      |
| `GRAILED_MAX_RESULTS_PER_SEARCH`            | `24`                       | normalized result cap                            |
| `GRAILED_USER_AGENT`                        | contact placeholder        | replace with an accurate contact identity        |

The registry refuses Grailed unless both authorization values are present. Do
not substitute a placeholder: set `GRAILED_AUTHORIZATION_REFERENCE` to the
retained non-secret reference that records the operator-established
authorization. One persistent resilient client per provider instance carries
pacing, bounded concurrency, retry/`Retry-After`, and circuit state across
searches.

Authorized-live `GRAILED_BASE_URL` accepts only
`https://www.grailed.com`. Credential-discovery bundles must remain on that
exact origin, Algolia application IDs are bounded alphanumeric identifiers, and
all provider redirects are handled manually. These controls prevent a page or
environment value from redirecting provider credentials to an arbitrary or
private host.

The API creates one provider runtime per application process; feed, search,
readiness, and provider health share it. The worker creates its own runtime.
Multiply provider request/concurrency budgets by the maximum API plus worker
replica count because state is not distributed between processes.

## Depop, Yahoo! Auctions Japan, and Mercari Japan

These authorized-live adapters use the same fail-closed variable family. Replace
`<PREFIX>` with `DEPOP`, `YAHOO_AUCTIONS_JP`, or `MERCARI_JP`.

| Variable                                     | Default                    | Purpose                                            |
| -------------------------------------------- | -------------------------- | -------------------------------------------------- |
| `<PREFIX>_PROVIDER_ENABLED`                  | follows scraping flag      | explicit enable/disable                            |
| `<PREFIX>_SCRAPING_ALLOWED`                  | `false`                    | separate operator activation switch                |
| `<PREFIX>_AUTHORIZATION_REFERENCE`           | none                       | retained non-secret provider permission reference  |
| `<PREFIX>_BASE_URL`                          | reviewed provider origin   | exact approved HTTPS origin                        |
| `<PREFIX>_REQUEST_TIMEOUT_MS`                | `8000`                     | 1000–60000                                         |
| `<PREFIX>_MIN_REQUEST_INTERVAL_MS`           | Depop `2000`; Japan `2500` | 250–60000 pacing                                   |
| `<PREFIX>_MAX_CONCURRENCY`                   | `2`                        | 1–10                                               |
| `<PREFIX>_MAX_RETRIES`                       | `2`                        | 0–5                                                |
| `<PREFIX>_BASE_BACKOFF_MS`                   | `250`                      | 0–10000                                            |
| `<PREFIX>_MAX_RETRY_AFTER_MS`                | `60000`                    | 0–300000                                           |
| `<PREFIX>_CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5`                        | 1–20                                               |
| `<PREFIX>_CIRCUIT_BREAKER_COOLDOWN_MS`       | `30000`                    | 1000–300000                                        |
| `<PREFIX>_MAX_RESULTS_PER_SEARCH`            | `48`                       | 1–200; adapters enforce their tighter contract cap |
| `<PREFIX>_USER_AGENT`                        | contact placeholder        | replace with an accurate deployment contact        |

Reviewed origins are:

- Depop: `https://webapi.depop.com`
- Yahoo! Auctions Japan: `https://auctions.yahoo.co.jp`
- Mercari Japan: `https://api.mercari.jp`

All three require enabled, scraping allowed, and a non-empty authorization
reference. Production construction rejects unreviewed origins, URL credentials,
paths, queries, and fragments. Japanese adapters preserve original Japanese
text separately from optional translated text and expose domestic/proxy
limitations; Yahoo auction analytics require a confirmed completed price.

## Health endpoint

`GET /providers/health` exposes only safe metadata:

- runtime mode, mock fallback policy, timeout, and provider limit
- provider ID/name, enabled/configured/active, real/mock mode
- implementation and health mode (`disabled`, `fixture`,
  `authorized-live`, `official-api`)
- capabilities, required environment variable names, reasons, and last error
  category

It does not return secret values, authorization documents, raw provider
responses, or credentials.

## Worker configuration

API and worker must receive the same provider variables. The worker creates
ingestion sources only for active real providers; it never ingests mock fixtures.

Scheduling variables are documented in
[the environment reference](environment.md). A missing provider schedule is not
success: inspect `worker_jobs_seeded.activeProviderIds` and
`blockedProviders`.

## Activation checklist

- [ ] acquisition matrix and approval record current
- [ ] credentials in secret management
- [ ] attribution/retention/deletion requirements implemented
- [ ] adapter fixture and resilience tests pass
- [ ] production mock invariants pass
- [ ] authorized staging smoke returns normalized real listings
- [ ] provider health and worker checkpoint advance
- [ ] rate-limit/circuit/incident alerts configured

Current repository status: all five real adapters are implemented and
fixture-verified. All remain externally blocked because credentials and/or
provider-specific authorization references are not configured. No credentialed
live smoke evidence is present.
