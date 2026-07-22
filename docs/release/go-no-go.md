# Launch Go / No-Go

## GO Criteria

- install passes
- typecheck passes
- build passes
- lint passes
- tests pass
- smoke tests pass
- API health is good
- web app loads
- auth works
- feed and search work
- provider failure fallback works
- no secret leakage appears in logs or UI
- analytics disclaimers are visible
- watchlist delivery limitations are visible
- known limitations are documented

## NO-GO Criteria

- deploy cannot start
- signup or login is broken
- feed or search is unusable
- database migrations fail
- provider failure crashes the app
- secrets are exposed in logs or UI
- saved-user features corrupt or lose user data
- analytics makes unsupported prediction, profit, or guaranteed-underpriced claims
- watchlist UI claims live notifications work when they do not
- rollback cannot be executed safely

## Decision Rule

- If any `NO-GO` item is true, do not cut or promote the launch candidate.
- If all `GO` items are true and remaining risks are documented as accepted limitations, the launch candidate is acceptable for a constrained preview tag.
