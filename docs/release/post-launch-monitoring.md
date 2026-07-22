# Post-Launch Monitoring

## Immediately After Deploy

- confirm `GET /health`
- confirm `GET /providers/health`
- confirm the web shell loads
- confirm signup, login, and logout
- confirm feed and search return usable results

## What to Watch

- repeated `feed_unavailable` or `search_unavailable` responses
- repeated provider preflight failures
- spikes in session-expired or unauthenticated errors during normal signed-in flows
- reports of saved-user data disappearing or failing to persist

## First 24-Hour Checklist

- review API logs for repeated request failures
- review provider health output for unexpected disabled or degraded states
- verify at least one real signup and login still works
- verify likes, saved searches, saved filters, settings, and watchlists still persist
- verify analytics still renders disclaimers and limited-data states honestly
- review tester feedback channels for repeated blockers

## When to Roll Back

- health endpoints fail consistently
- auth is broken for multiple testers
- feed/search is broadly unusable
- saved-user data is at risk
- a misconfiguration exposes sensitive information or breaks provider safety assumptions
