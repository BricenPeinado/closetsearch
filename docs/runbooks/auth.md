# Authentication and Account Security

## Production boundary

Production uses PostgreSQL-backed, opaque cookie sessions. SQLite preserves a
local/test compatibility implementation; it is not the production session
store.

Primary routes:

- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `POST /auth/logout-all`
- `POST /users/onboarding`

The API prepares auth context from the cookie before domain routing. Protected
routes derive the user only from that context and reject client-supplied
`userId`/`user_id`.

## Passwords

Passwords are stored as salted, parameterized scrypt hashes. Legacy hashes are
read only for compatibility and rehashed after successful verification.

New signup/reset policy:

- 12–128 Unicode characters
- no control characters
- reject a maintained common-password set
- reject the current username or email local-part
- no arbitrary character-class rules, so passphrases work

An injectable privacy-preserving breached-password checker exists, but its
default is disabled. Production integration remains blocked until a provider,
terms, timeout/outage policy, and no-plaintext-leak tests are approved.

## Sessions and cookies

PostgreSQL stores:

- session ID and user ownership
- a peppered hash of the random token
- creation, expiry, last-seen, and revocation timestamps
- bounded user-agent metadata
- a one-way IP hint in production

The raw token appears only in the cookie. Cookie behavior:

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- bounded `Max-Age`
- `Secure` required in production

Production startup requires:

```sh
AUTH_ALLOWED_ORIGINS=https://app.example.com
AUTH_COOKIE_SECURE=true
AUTH_SESSION_PEPPER=<at-least-32-secret-characters>
```

Rotating the pepper intentionally revokes all sessions.

## Email verification and recovery routes

PostgreSQL-backed routes:

- `PUT /me/email`
- `POST /me/email/verification`
- `POST /auth/verify-email`
- `POST /auth/password-reset/request`
- `POST /auth/password-reset/complete`
- `POST /me/account-export`
- `POST /account/export`
- `DELETE /me`

The web app exposes:

- `/forgot-password`
- `/reset-password?token=...`
- `/verify-email?token=...`
- `/account/export?token=...`
- profile controls for email, verification, export request, and confirmed
  deletion

Token rules:

- high-entropy random raw value
- purpose-separated peppered SHA-256 digest in the database
- raw value exists only long enough to build the action message
- a new token supersedes the previous active token for the same purpose
- atomic one-time consumption
- verification TTL: 24 hours
- password reset TTL: 30 minutes
- export TTL: 15 minutes
- action link token is placed in the URL fragment, read by the client, and
  removed from browser history immediately

Password-reset requests return the same accepted response for unknown,
unverified, invalid, and known verified email inputs. A successful reset updates
the hash, consumes/invalidate reset tokens, and revokes all user sessions in one
transaction.

The email sender defaults to disabled and reports `not_configured`; no raw token
is returned through the API. `EMAIL_TRANSPORT=resend` connects account-action
delivery to the shared Resend transport and requires `RESEND_API_KEY`,
`EMAIL_FROM_ADDRESS`, an explicit HTTPS `ACCOUNT_ACTION_BASE_URL`, and the
production webhook/public-origin controls documented in
[Alerts and watchlists](alerts-watchlists.md). The repository contains the
transport, not production credentials, sender verification, or staging delivery
evidence, so users cannot receive deployed action links from this checkout.

Verifying an email identity does not silently opt the user into marketing or
watchlist alerts. Alert email requires a separate current consent record and
global/per-watchlist enablement. Account-security messages are transactional and
remain limited to the action the user requested.

## Export and deletion

Export requires a verified email and one-time token. It includes owned account,
identity, session metadata, likes, searches, filters, watchlists, alert
preferences/matches, and settings. It excludes password hashes, session-token
hashes, and account-token hashes.

Deletion requires the exact username confirmation, deletes the user and
foreign-key-cascaded owned state transactionally, and clears the browser cookie.
Provider-wide listing observations and price history are not user-owned and are
not deleted with an account.

## CSRF, abuse, and request limits

Cookie-authenticated mutations:

- reject `Sec-Fetch-Site: cross-site`
- validate `Origin` or `Referer` against exact allowed origins
- reject missing trustworthy browser origin in production
- enforce a streamed body-byte limit
- apply fixed-window rate limits to auth/account actions
- clear invalid/expired session cookies when appropriate

The fixed-window limiter is process-local. Replace or front it with a durable/
distributed control before unrestricted multi-replica public traffic.

## Verification

Tests cover:

- signup uniqueness and password policy
- credential verification/rehash
- hashed session resolution, touch, expiry, revocation, logout-all
- origin/CSRF, body limit, spoofed user ID, and rate limit behavior
- email uniqueness/verification and token supersession/expiry/reuse
- generic password-reset request response
- reset transaction and all-session revocation
- export secret exclusion
- delete confirmation and cascade behavior
- PostgreSQL production route behavior
- Resend transport mapping and fail-closed disabled behavior
- account-security/action-page component behavior
- PostgreSQL-backed browser account deletion and session invalidation when the
  Playwright persistence driver is PostgreSQL

## Remaining blockers

- approved Resend account, API key, verified sender/domain, webhook secret,
  HTTPS action/callback origins, and staging account-action evidence
- approved breached-password service
- distributed rate limiter/session abuse controls for broad horizontal scale
- OAuth/social login and device/session management UI (intentionally deferred)

Do not claim verification or password recovery is operational end to end until
the outbound email provider and browser action-link flow pass staging E2E.
