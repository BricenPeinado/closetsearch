# Auth

## Overview

Milestone 15 moves ClosetSearch off browser-trusted identity and onto a small cookie-backed server-session foundation inside `apps/api`.

Current auth flow:

- `POST /auth/signup` validates username/password, hashes the password, creates a user, creates a server-side session, and sets the session cookie.
- `POST /auth/login` verifies the password, creates a new server-side session, and sets the session cookie.
- `GET /auth/me` reads the session cookie and returns the current public user when the session is valid.
- `POST /auth/logout` revokes the current session and clears the cookie.
- `POST /auth/logout-all` revokes all sessions for the authenticated user and clears the current cookie.

The web app now loads the signed-in user from `/auth/me` and keeps session state in React memory only.

The API also contains route-ready account-security services for email identity,
verification, password reset, account export, and account deletion. These
services are not public routes yet. Outbound email is disabled unless a caller
explicitly injects a configured sender.

## Password Hashing

ClosetSearch currently uses Node's built-in `crypto.scrypt` with:

- unique random salt per password
- explicit algorithm metadata in the stored hash string
- stored work-factor parameters
- no plaintext password storage

Stored password hashes currently use a `scrypt$...` format that includes:

- algorithm
- parameters
- salt
- derived hash

Legacy SHA-256 hashes remain readable only as a compatibility bridge for old demo users. On successful login, legacy hashes are re-hashed into the new `scrypt` format.

New password-reset flows apply the policy in
`apps/api/src/auth/password-policy.ts`:

- 12 to 128 Unicode characters
- no control characters
- reject a maintained local set of known-common values
- reject passwords containing the current username or email local-part
- allow passphrases without arbitrary character-class rules

The policy supports an injected breached-password checker. The default checker
is deliberately disabled and performs no network request. Production activation
is blocked until an approved privacy-preserving provider and data-handling terms
are selected, its timeout and outage policy are defined, and integration tests
prove that plaintext passwords are never logged or sent to an unapproved
service. A deployment may set the policy to fail closed when that configured
check is unavailable.

`registerUserWithPasswordPolicy` is the route-ready registration boundary. The
existing signup route must be moved to that asynchronous boundary when the
account routes are integrated; the legacy synchronous `createUser` function is
retained for compatibility with the current router and seed/tests.

## Verified Email And One-Time Tokens

SQLite migration `007_account_security` adds:

- one normalized email identity per user, with a distinct `verified_at`
  timestamp
- purpose-bound tokens for `email_verification`, `password_reset`, and
  `account_export`

Only a SHA-256 hash of each high-entropy token plus the configured auth pepper
is stored. Raw tokens exist only long enough to construct the injected outbound
message. Browser action links put the token in the URL fragment so it is not
sent in ordinary HTTP request targets or referrer headers. Tokens have
purpose-specific expiry:

- email verification: 24 hours
- password reset: 30 minutes
- account export: 15 minutes

Issuing another token supersedes the prior active token for that user and
purpose. Consumption is atomic and one-time. Changing an email invalidates
outstanding account tokens. Password reset consumes the token, changes the
password hash, and revokes all user sessions in one `BEGIN IMMEDIATE`
transaction.

`AccountRecoveryService` returns the same accepted response for unknown,
unverified, and malformed password-reset email input so a route adapter does not
have to expose account existence.

## Account Export And Deletion

`AccountLifecycleService` provides route-ready operations:

- export requires a verified email and a short-lived one-time export token
- the export includes account data, email identity, likes, searches, filters,
  watchlists, alert preferences/matches, settings, and non-secret session
  metadata
- password hashes, session-token hashes, and one-time tokens are excluded
- deletion requires an explicit username confirmation and deletes the user plus
  foreign-key-cascaded user-owned records in one transaction

Provider-wide listing observations and price history are not keyed to a user and
are therefore not deleted with an account. The beta privacy copy calls this out.
Expired-token cleanup exists at the repository boundary but still needs to be
wired into the production retention worker.

## Session Storage

Sessions are stored in SQLite in the `auth_sessions` table.

Fields include:

- `id`
- `user_id`
- `session_token_hash`
- `created_at`
- `expires_at`
- `last_seen_at`
- `revoked_at`
- `user_agent`
- `ip_hint`

Only a hash of the session token is stored in the database. The raw token is only sent to the browser in the cookie.

## Cookie Behavior

Current cookie settings:

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- `Max-Age` based on `AUTH_SESSION_TTL_DAYS`
- `Secure` when `AUTH_COOKIE_SECURE=true` or when production defaults require it

Relevant environment variables:

- `AUTH_SESSION_COOKIE_NAME`
- `AUTH_SESSION_TTL_DAYS`
- `AUTH_COOKIE_SECURE`
- `AUTH_ALLOWED_ORIGINS`
- `AUTH_SESSION_PEPPER`
- `AUTH_TOKEN_PEPPER`
- `HTTP_BODY_LIMIT_BYTES`

Notes:

- `AUTH_ALLOWED_ORIGINS` is required for credentialed local dev cross-origin requests.
- changing the session/token pepper invalidates existing sessions because the stored token hashes will no longer match.

## Route Protection

Protected routes now derive authority from the authenticated session instead of trusting arbitrary `userId` values from the client.

Current protected routes include:

- `POST /users/onboarding`
- `GET /likes`
- `POST /likes`
- `DELETE /likes`
- `GET /recent-searches`
- `POST /recent-searches`
- `DELETE /recent-searches`
- `GET /saved-searches`
- `POST /saved-searches`
- `DELETE /saved-searches`
- `POST /auth/logout-all`

Signed-out browsing still works for:

- feed
- search
- brand browsing
- locked analytics preview

Feed personalization and analytics premium access now use the authenticated cookie session when available instead of query-string `userId` authority.

## CSRF And Request Abuse Controls

Cookie-authenticated mutation requests enforce browser-origin checks:

- requests with `Sec-Fetch-Site: cross-site` are rejected
- an `Origin` or `Referer` origin, when present, must exactly match
  `AUTH_ALLOWED_ORIGINS`
- production rejects browser-context mutations that do not carry a trustworthy
  origin

Signup and login use a bounded process-local IP rate limiter as a first line of
defense. Multi-instance durable rate limiting remains required before horizontal
production scaling.

JSON bodies are streamed through a byte counter and rejected with `413` when
they exceed `HTTP_BODY_LIMIT_BYTES`; declared oversized bodies are rejected
before being read.

## Session Expiry and Logout

Session expiry behavior:

- expired or revoked sessions no longer authenticate requests
- `/auth/me` returns `401` for missing, expired, or revoked sessions
- auth-related `401` responses clear the session cookie when appropriate
- the web app falls back to signed-out state when it encounters `unauthenticated` or `session_expired`

Logout behavior:

- `POST /auth/logout` revokes the current session only
- `POST /auth/logout-all` revokes all sessions for the current user

## Local Development

Typical local dev settings:

```sh
AUTH_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
AUTH_SESSION_COOKIE_NAME=closetsearch_session
AUTH_SESSION_TTL_DAYS=14
AUTH_COOKIE_SECURE=false
```

If the API and web app are running on different local ports, the frontend must send credentialed requests and the API must not use `Access-Control-Allow-Origin: *`.

## Known Limitations

Intentionally deferred after Milestone 15:

- OAuth and social login
- public route and web-UI integration for email verification, password reset,
  export, and deletion
- a configured transactional email provider
- an approved breached-password integration
- device/session management UI
- roles and admin permissions
- managed production secrets strategy
- distributed or multi-instance session infrastructure

Production startup fails closed when the session pepper is shorter than 32
characters, cookies are not secure, allowed origins are not explicit HTTPS
origins, or provider configuration permits mock inventory.

The current implementation is a production-auth foundation, not a complete account platform.
