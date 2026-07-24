# Environment Reference

This reference documents the meaningful environment variables currently used by ClosetSearch.

Do not commit real secrets. Use `.env.example`, `apps/api/.env.example`, and `apps/web/.env.example` as starting points only.

## API Runtime

### `HOST`

- Required: optional
- Default: `127.0.0.1`
- Local example: `HOST=127.0.0.1`
- Beta note: bind to the interface your process manager expects
- Safety note: not sensitive

### `PORT`

- Required: optional
- Default: `4000`
- Local example: `PORT=4000`
- Beta note: usually set by the host or process manager
- Safety note: not sensitive

### `CLOSETSEARCH_DB_PATH`

- Required: optional
- Default: `apps/api/.data/closetsearch.sqlite`
- Local example: `CLOSETSEARCH_DB_PATH=./apps/api/.data/closetsearch.sqlite`
- Beta note: point at writable persistent storage
- Safety note: not a secret, but avoid exposing internal filesystem paths broadly

### `HTTP_BODY_LIMIT_BYTES`

- Required: optional
- Default: `65536`
- Local example: `HTTP_BODY_LIMIT_BYTES=65536`
- Production note: bounds every JSON request body before parsing
- Safety note: not sensitive

### `SHUTDOWN_TIMEOUT_MS`

- Required: optional
- Default: `10000`
- Local example: `SHUTDOWN_TIMEOUT_MS=10000`
- Production note: maximum graceful HTTP drain time before open connections are closed
- Safety note: not sensitive

## Auth and Session

### `AUTH_ALLOWED_ORIGINS`

- Required: yes for cross-origin cookie auth
- Default: `http://localhost:5173,http://127.0.0.1:5173`
- Local example: `AUTH_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`
- Beta note: must exactly match deployed web origins
- Safety note: not sensitive

### `AUTH_SESSION_COOKIE_NAME`

- Required: optional
- Default: `closetsearch_session`
- Local example: `AUTH_SESSION_COOKIE_NAME=closetsearch_session`
- Beta note: keep stable across restarts unless you intentionally want to rotate sessions
- Safety note: not sensitive

### `AUTH_SESSION_TTL_DAYS`

- Required: optional
- Default: `14`
- Local example: `AUTH_SESSION_TTL_DAYS=14`
- Beta note: shorter TTLs reduce risk but increase re-login frequency
- Safety note: not sensitive

### `AUTH_COOKIE_SECURE`

- Required: optional
- Default: `true` in production-like `NODE_ENV`, otherwise `false`
- Local example: `AUTH_COOKIE_SECURE=false`
- Beta note: set `true` for HTTPS deployments
- Safety note: not sensitive

### `AUTH_SESSION_PEPPER`

- Required: strongly recommended for beta
- Default: empty string
- Local example: `AUTH_SESSION_PEPPER=replace-with-local-secret`
- Beta note: use a real secret and keep it stable during a beta run
- Safety note: sensitive secret, do not commit

### `AUTH_TOKEN_PEPPER`

- Required: optional fallback only
- Default: empty string
- Local example: `AUTH_TOKEN_PEPPER=replace-with-local-secret`
- Beta note: legacy fallback if `AUTH_SESSION_PEPPER` is not used
- Safety note: sensitive secret, do not commit

### `NODE_ENV`

- Required: optional
- Default: runtime default
- Local example: `NODE_ENV=development`
- Beta note: affects auth cookie secure defaults
- Safety note: not sensitive

## Provider Runtime

### `PROVIDER_RUNTIME_MODE`

- Required: optional
- Default: `mock`, unless a fully authorized Grailed setup causes the runtime fallback to prefer `real`
- Local example: `PROVIDER_RUNTIME_MODE=mock`
- Beta note: `mock` is safest, `hybrid` is useful when partial real coverage is allowed
- Safety note: not sensitive

### `PROVIDER_ALLOW_MOCK_FALLBACK`

- Required: optional
- Default: `true`
- Local example: `PROVIDER_ALLOW_MOCK_FALLBACK=true`
- Beta note: keep enabled for constrained beta unless you explicitly want hard real-provider failures
- Safety note: not sensitive

### `PROVIDER_REQUEST_TIMEOUT_MS`

- Required: optional
- Default: `10000`
- Local example: `PROVIDER_REQUEST_TIMEOUT_MS=10000`
- Beta note: larger values may improve resilience but slow user-visible failures
- Safety note: not sensitive

### `PROVIDER_MAX_ACTIVE_PROVIDERS`

- Required: optional
- Default: `2`
- Local example: `PROVIDER_MAX_ACTIVE_PROVIDERS=2`
- Beta note: keep low until provider reliability is proven
- Safety note: not sensitive

### `PROVIDER_MOCK_ENABLED`

- Required: optional
- Default: `true`
- Local example: `PROVIDER_MOCK_ENABLED=true`
- Beta note: useful for demos and fallback
- Safety note: not sensitive

## Grailed Provider

### `GRAILED_PROVIDER_ENABLED`

- Required: optional
- Default: inherits from `GRAILED_SCRAPING_ALLOWED`
- Local example: `GRAILED_PROVIDER_ENABLED=false`
- Beta note: keep off unless the beta is explicitly allowed to use the authorized live path
- Safety note: not sensitive

### `GRAILED_SCRAPING_ALLOWED`

- Required: optional
- Default: `false`
- Local example: `GRAILED_SCRAPING_ALLOWED=false`
- Beta note: this is the compliance gate; only enable with written permission
- Safety note: not sensitive, but operationally important

### `GRAILED_BASE_URL`

- Required: optional
- Default: `https://www.grailed.com`
- Local example: `GRAILED_BASE_URL=https://www.grailed.com`
- Beta note: only change when the authorized integration path changes
- Safety note: not sensitive

### `GRAILED_REQUEST_TIMEOUT_MS`

- Required: optional
- Default: `5000`
- Local example: `GRAILED_REQUEST_TIMEOUT_MS=5000`
- Beta note: keep conservative to avoid long hanging searches
- Safety note: not sensitive

### `GRAILED_MIN_REQUEST_INTERVAL_MS`

- Required: optional
- Default: `3000`
- Local example: `GRAILED_MIN_REQUEST_INTERVAL_MS=3000`
- Beta note: keep conservative for compliance and stability
- Safety note: not sensitive

### `GRAILED_MAX_RESULTS_PER_SEARCH`

- Required: optional
- Default: `24`
- Local example: `GRAILED_MAX_RESULTS_PER_SEARCH=24`
- Beta note: low limits are safer until live demand is known
- Safety note: not sensitive

### `GRAILED_USER_AGENT`

- Required: optional
- Default: `ClosetSearchBot/0.1 contact:<project-contact-email>`
- Local example: `GRAILED_USER_AGENT=ClosetSearchBot/0.1 contact:team@example.com`
- Beta note: replace the placeholder contact before any authorized live beta
- Safety note: not a secret, but should be accurate

## Web Runtime

### `VITE_API_BASE_URL`

- Required: optional
- Default: `http://localhost:4000`
- Local example: `VITE_API_BASE_URL=http://localhost:4000`
- Beta note: must point to the deployed API origin and align with `AUTH_ALLOWED_ORIGINS`
- Safety note: not sensitive

## Beta Smoke Test

### `CLOSETSEARCH_API_BASE_URL`

- Required: optional
- Default: `http://127.0.0.1:4000`
- Local example: `CLOSETSEARCH_API_BASE_URL=http://127.0.0.1:4000`
- Beta note: point at the deployed API when running `corepack pnpm beta:smoke`
- Safety note: not sensitive

### `CLOSETSEARCH_SMOKE_TIMEOUT_MS`

- Required: optional
- Default: `5000`
- Local example: `CLOSETSEARCH_SMOKE_TIMEOUT_MS=5000`
- Beta note: increase if the deployment target is slow but healthy
- Safety note: not sensitive
