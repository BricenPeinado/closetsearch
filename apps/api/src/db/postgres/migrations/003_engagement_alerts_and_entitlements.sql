CREATE TABLE likes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, listing_id)
);

CREATE INDEX likes_user_idx ON likes(user_id, created_at DESC);

CREATE TABLE recent_searches (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_hash TEXT NOT NULL,
  query JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, query_hash),
  CHECK (char_length(query_hash) BETWEEN 32 AND 256),
  CHECK (jsonb_typeof(query) = 'object')
);

CREATE INDEX recent_searches_user_idx
  ON recent_searches(user_id, submitted_at DESC);

CREATE TABLE saved_searches (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  query JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, query_hash),
  CHECK (char_length(btrim(label)) BETWEEN 1 AND 160),
  CHECK (char_length(query_hash) BETWEEN 32 AND 256),
  CHECK (jsonb_typeof(query) = 'object')
);

CREATE INDEX saved_searches_user_idx
  ON saved_searches(user_id, updated_at DESC);

CREATE TABLE saved_filters (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  filter_hash TEXT NOT NULL,
  filters JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, filter_hash),
  CHECK (char_length(btrim(label)) BETWEEN 1 AND 160),
  CHECK (char_length(filter_hash) BETWEEN 32 AND 256),
  CHECK (jsonb_typeof(filters) = 'object')
);

CREATE INDEX saved_filters_user_idx
  ON saved_filters(user_id, updated_at DESC);

CREATE TABLE watchlists (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  query_text TEXT,
  canonical_brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
  category TEXT,
  source_marketplace TEXT,
  listing_type TEXT,
  market_status TEXT,
  min_price_minor BIGINT,
  max_price_minor BIGINT,
  price_currency TEXT,
  size TEXT,
  condition TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  frequency TEXT NOT NULL DEFAULT 'daily',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (char_length(btrim(label)) BETWEEN 1 AND 160),
  CHECK (listing_type IS NULL OR listing_type IN ('buy_now', 'auction', 'offer', 'unknown')),
  CHECK (market_status IS NULL OR market_status IN ('active', 'sold', 'unknown')),
  CHECK (min_price_minor IS NULL OR min_price_minor >= 0),
  CHECK (max_price_minor IS NULL OR max_price_minor >= 0),
  CHECK (
    min_price_minor IS NULL
    OR max_price_minor IS NULL
    OR max_price_minor >= min_price_minor
  ),
  CHECK (
    (min_price_minor IS NULL AND max_price_minor IS NULL AND price_currency IS NULL)
    OR price_currency ~ '^[A-Z]{3}$'
  ),
  CHECK (frequency IN ('instant', 'hourly', 'daily', 'weekly'))
);

CREATE INDEX watchlists_enabled_idx
  ON watchlists(enabled, source_marketplace, canonical_brand_id, updated_at)
  WHERE enabled = TRUE;

CREATE INDEX watchlists_user_idx
  ON watchlists(user_id, updated_at DESC);

CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  frequency TEXT NOT NULL DEFAULT 'daily',
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (frequency IN ('instant', 'hourly', 'daily', 'weekly')),
  CHECK (
    (quiet_hours_start IS NULL AND quiet_hours_end IS NULL)
    OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
  ),
  CHECK (char_length(btrim(timezone)) BETWEEN 1 AND 80)
);

CREATE TABLE engagement_events (
  event_id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  privacy_session_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  request_id UUID,
  ranked_position INTEGER,
  viewport_duration_ms INTEGER,
  search_query_hash TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (char_length(privacy_session_hash) BETWEEN 32 AND 256),
  CHECK (
    event_type IN (
      'listing_view',
      'listing_open',
      'like',
      'unlike',
      'search_submit',
      'filter_apply',
      'saved_search',
      'saved_filter',
      'watchlist_create',
      'hide',
      'recommendation_request',
      'recommendation_impression',
      'conversion'
    )
  ),
  CHECK (ranked_position IS NULL OR ranked_position >= 0),
  CHECK (viewport_duration_ms IS NULL OR viewport_duration_ms >= 0),
  CHECK (event_type <> 'listing_view' OR viewport_duration_ms >= 1000),
  CHECK (jsonb_typeof(properties) = 'object')
);

CREATE INDEX engagement_events_user_time_idx
  ON engagement_events(user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX engagement_events_listing_time_idx
  ON engagement_events(listing_id, event_type, occurred_at DESC)
  WHERE listing_id IS NOT NULL;

CREATE INDEX engagement_events_rollup_idx
  ON engagement_events(received_at, event_id);

CREATE TABLE listing_engagement_daily (
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  view_count BIGINT NOT NULL DEFAULT 0,
  open_count BIGINT NOT NULL DEFAULT 0,
  like_count BIGINT NOT NULL DEFAULT 0,
  unlike_count BIGINT NOT NULL DEFAULT 0,
  hide_count BIGINT NOT NULL DEFAULT 0,
  conversion_count BIGINT NOT NULL DEFAULT 0,
  unique_session_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (listing_id, event_date),
  CHECK (
    view_count >= 0
    AND open_count >= 0
    AND like_count >= 0
    AND unlike_count >= 0
    AND hide_count >= 0
    AND conversion_count >= 0
    AND unique_session_count >= 0
  )
);

CREATE INDEX listing_engagement_daily_date_idx
  ON listing_engagement_daily(event_date DESC, view_count DESC);

CREATE TABLE alert_matches (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  watchlist_id UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'unseen',
  match_reasons JSONB NOT NULL,
  first_matched_at TIMESTAMPTZ NOT NULL,
  last_matched_at TIMESTAMPTZ NOT NULL,
  seen_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  UNIQUE (watchlist_id, listing_id),
  CHECK (state IN ('unseen', 'seen', 'dismissed')),
  CHECK (jsonb_typeof(match_reasons) = 'array'),
  CHECK (last_matched_at >= first_matched_at),
  CHECK (seen_at IS NULL OR seen_at >= first_matched_at),
  CHECK (dismissed_at IS NULL OR dismissed_at >= first_matched_at)
);

CREATE INDEX alert_matches_inbox_idx
  ON alert_matches(user_id, state, last_matched_at DESC);

CREATE TABLE alert_deliveries (
  id UUID PRIMARY KEY,
  alert_match_id UUID NOT NULL REFERENCES alert_matches(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  destination_hash TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (channel IN ('in_app', 'email')),
  CHECK (status IN ('queued', 'processing', 'delivered', 'retry_wait', 'failed', 'dead_letter', 'suppressed')),
  CHECK (attempt_count >= 0),
  CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  CHECK (destination_hash IS NULL OR char_length(destination_hash) BETWEEN 32 AND 256),
  CHECK (delivered_at IS NULL OR delivered_at >= created_at)
);

CREATE INDEX alert_deliveries_due_idx
  ON alert_deliveries(status, next_attempt_at, attempt_count)
  WHERE status IN ('queued', 'retry_wait');

CREATE TABLE billing_subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  billing_provider TEXT NOT NULL,
  external_customer_id TEXT,
  external_subscription_id TEXT,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (billing_provider, external_subscription_id),
  CHECK (billing_provider IN ('admin', 'stripe', 'paddle', 'other')),
  CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired', 'development')),
  CHECK (
    current_period_start IS NULL
    OR current_period_end IS NULL
    OR current_period_end >= current_period_start
  )
);

CREATE INDEX billing_subscriptions_user_idx
  ON billing_subscriptions(user_id, status, current_period_end DESC);

CREATE TABLE premium_entitlements (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  entitlement_provider TEXT NOT NULL,
  external_reference TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (char_length(feature_key) BETWEEN 1 AND 120),
  CHECK (entitlement_provider IN ('admin', 'subscription', 'promotion', 'migration')),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (revoked_at IS NULL OR revoked_at >= starts_at),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX premium_entitlements_identity_idx
  ON premium_entitlements(
    user_id,
    feature_key,
    entitlement_provider,
    external_reference
  );

CREATE INDEX premium_entitlements_active_idx
  ON premium_entitlements(user_id, feature_key, starts_at, ends_at)
  WHERE revoked_at IS NULL;

CREATE TABLE billing_webhook_events (
  id UUID PRIMARY KEY,
  billing_provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  UNIQUE (billing_provider, external_event_id),
  CHECK (char_length(payload_sha256) = 64),
  CHECK (signature_verified = TRUE)
);
