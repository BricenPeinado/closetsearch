# Alerts and Watchlists

## Purpose

Milestone 19 adds alert-ready watchlists and notification preference shell data without activating real alert delivery.

This runbook documents what is implemented now, what stays inactive, and what future work is still required before ClosetSearch can claim real alerts.

## Watchlist Criteria

Each watchlist is scoped to an authenticated user and can store any mix of these criteria:

- label
- query text
- brand
- category
- source marketplace
- listing type
- min price amount
- max price amount
- price currency
- size
- condition
- enabled state

Validation rules:

- at least one meaningful criterion is required
- max price cannot be lower than min price
- blank labels are replaced with generated labels such as `Rick Owens under $300` or `Archive Denim search`

## API Surface

Protected routes are session-scoped and do not trust arbitrary `userId` values from request bodies or query params.

Implemented routes:

- `GET /me/watchlists`
- `POST /me/watchlists`
- `PATCH /me/watchlists/:id`
- `DELETE /me/watchlists/:id`
- `GET /me/notification-preferences`
- `PATCH /me/notification-preferences`
- `GET /me/alert-matches`

`GET /me/alert-matches` is intentionally honest: it returns stored candidate data only and includes inactive-delivery copy.

## Data Model

### `watchlists`

Stores saved user intent for future alerts.

Important fields:

- `user_id`
- `label`
- `query_text`
- `brand`
- `category`
- `source`
- `listing_type`
- `min_price_amount`
- `max_price_amount`
- `price_currency`
- `condition`
- `size`
- `enabled`
- `created_at`
- `updated_at`

### `notification_preferences`

Stores a delivery-preference shell only.

Important fields:

- `user_id`
- `email_enabled`
- `push_enabled`
- `sms_enabled`
- `in_app_enabled`
- `frequency`
- `quiet_hours_start`
- `quiet_hours_end`
- `created_at`
- `updated_at`

### `alert_matches`

Stores deduped candidate matches for future alert review or delivery work.

Important fields:

- `user_id`
- `watchlist_id`
- `listing_id`
- `source`
- `source_listing_id`
- `matched_reason_json`
- `status`
- `first_matched_at`
- `last_matched_at`
- `dismissed_at`

Current behavior:

- rows can be stored manually or by future services
- duplicates are collapsed by watchlist and listing identity
- storing a candidate does not imply that any notification was sent

## Matching Function

The pure matching foundation lives in `apps/api/src/services/alertMatchService.ts`.

Current behavior:

- watched brand must match if provided
- query text matches loosely against listing title, brand, category, and source text
- watched category, source, and listing type must match if provided
- price range and currency must match if provided
- watched size and condition match when the listing exposes those fields
- disabled watchlists do not match
- matches return explainable reason objects instead of only a boolean

Example reason codes:

- `brand_match`
- `query_match`
- `category_match`
- `source_match`
- `listing_type_match`
- `price_over_min`
- `price_under_max`

## Notification Preference Shell

The current UI and API can save these preferences:

- in-app enabled
- email enabled
- push enabled
- SMS enabled
- frequency
- quiet hours start and end

Important limitation:

- these values are preference shell data only in this milestone
- the frontend should keep email, push, and SMS controls visually marked as coming later
- saving preferences must not be described as activating delivery

## Inactive Delivery Channels

The following are not active in Milestone 19:

- email notifications
- push notifications
- SMS notifications
- real-time watchlist monitoring
- background delivery workers
- marketplace polling loops dedicated to alerts

User-facing copy should stay explicit that watchlists save what the user wants to track and that delivery will come in a later milestone.

## Future Work Before Real Alerts

Before ClosetSearch can claim active alerts, a future milestone still needs:

- candidate-match population strategy
- monitoring cadence and polling rules
- dedupe, suppression, dismissal, and resend policy
- real outbound channel integration
- delivery logs and failure handling
- user-facing alert inbox or history UX
- operational safeguards for noisy or expensive watchlists
