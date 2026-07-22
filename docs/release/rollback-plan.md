# Rollback Plan

## When to Consider Rollback

- health endpoints fail after deploy
- signup, login, or logout stops working
- feed or search becomes unusable
- saved-user data behaves unsafely
- logs suggest secret exposure or provider misconfiguration

## Evidence to Collect Before Rollback

- screenshots of the failing route or flow
- `GET /health` result
- `GET /providers/health` result
- recent structured API logs with request IDs
- notes about whether mock, hybrid, or real provider mode was active

## App Rollback Steps

1. Stop promoting the current build.
2. Restore the previous known-good API build artifact.
3. Restore the previous known-good web build artifact.
4. Re-run health and smoke checks.

## Database Handling

- Back up the SQLite file before risky migrations or manual interventions.
- Prefer forward-fix over destructive rollback if a migration has already touched real user data.
- If a migration created a bad release but data is still compatible, roll back app code first and keep the database in place.
- If the database must be restored, use the last known-good backup and confirm demo data does not overwrite real user data.

## Provider Safety Steps

- switch to `PROVIDER_RUNTIME_MODE=mock` for the safest fallback
- or keep `PROVIDER_RUNTIME_MODE=real` / `hybrid` with `PROVIDER_ALLOW_MOCK_FALLBACK=true`
- disable risky real providers through their environment flags if needed
- verify `GET /providers/health` after changing runtime mode

## Tester Communication

- tell testers the release was rolled back due to a launch-blocking issue
- describe whether auth, feed/search, or saved features were affected
- avoid claiming exact recovery times unless confirmed
- ask testers to retry only after the smoke checks are green again
