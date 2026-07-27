-- Typed marketplace price evidence. Existing rows are backfilled conservatively:
-- an auction is only completed evidence when a confirmed sold price exists.
ALTER TABLE listings
  ADD COLUMN material TEXT,
  ADD COLUMN color TEXT,
  ADD COLUMN model TEXT,
  ADD COLUMN item_family TEXT,
  ADD COLUMN marketplace_region TEXT,
  ADD COLUMN description TEXT,
  ADD COLUMN original_title TEXT,
  ADD COLUMN original_description TEXT,
  ADD COLUMN original_language TEXT,
  ADD COLUMN translated_title TEXT,
  ADD COLUMN translated_description TEXT,
  ADD COLUMN marketplace_limitations JSONB,
  ADD CONSTRAINT listings_marketplace_limitations_check
    CHECK (
      marketplace_limitations IS NULL
      OR jsonb_typeof(marketplace_limitations) = 'object'
    );

ALTER TABLE price_observations
  ADD COLUMN observation_kind TEXT NOT NULL DEFAULT 'asking',
  ADD COLUMN analytics_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN landed_price_minor BIGINT,
  ADD COLUMN landed_currency TEXT,
  ADD COLUMN current_bid_minor BIGINT,
  ADD COLUMN current_bid_currency TEXT,
  ADD COLUMN completed_auction_price_minor BIGINT,
  ADD COLUMN completed_auction_currency TEXT,
  ADD COLUMN buy_now_price_minor BIGINT,
  ADD COLUMN buy_now_currency TEXT,
  ADD COLUMN bid_count INTEGER,
  ADD COLUMN auction_ends_at TIMESTAMPTZ,
  ADD COLUMN source_marketplace TEXT,
  ADD COLUMN provider_id TEXT,
  ADD COLUMN canonical_brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
  ADD COLUMN provider_brand TEXT,
  ADD COLUMN category TEXT,
  ADD COLUMN listing_type TEXT,
  ADD COLUMN condition TEXT,
  ADD COLUMN size TEXT,
  ADD COLUMN material TEXT,
  ADD COLUMN color TEXT,
  ADD COLUMN model TEXT,
  ADD COLUMN item_family TEXT,
  ADD COLUMN marketplace_region TEXT;

-- Legacy rows can be classified without guessing auction semantics. Repository
-- writes after this migration snapshot the richer listing dimensions below.
UPDATE price_observations
SET observation_kind = CASE
  WHEN sold_price_minor IS NOT NULL THEN 'confirmed_sold'
  ELSE 'asking'
END;

ALTER TABLE price_observations
  ADD CONSTRAINT price_observations_kind_check
    CHECK (
      observation_kind IN (
        'asking',
        'current_bid',
        'completed_auction',
        'confirmed_sold'
      )
    ),
  ADD CONSTRAINT price_observations_landed_money_check
    CHECK (
      (landed_price_minor IS NULL AND landed_currency IS NULL)
      OR (landed_price_minor >= 0 AND landed_currency ~ '^[A-Z]{3}$')
    ),
  ADD CONSTRAINT price_observations_current_bid_money_check
    CHECK (
      (current_bid_minor IS NULL AND current_bid_currency IS NULL)
      OR (current_bid_minor >= 0 AND current_bid_currency ~ '^[A-Z]{3}$')
    ),
  ADD CONSTRAINT price_observations_completed_auction_money_check
    CHECK (
      (
        completed_auction_price_minor IS NULL
        AND completed_auction_currency IS NULL
      )
      OR (
        completed_auction_price_minor >= 0
        AND completed_auction_currency ~ '^[A-Z]{3}$'
      )
    ),
  ADD CONSTRAINT price_observations_buy_now_money_check
    CHECK (
      (buy_now_price_minor IS NULL AND buy_now_currency IS NULL)
      OR (buy_now_price_minor >= 0 AND buy_now_currency ~ '^[A-Z]{3}$')
    ),
  ADD CONSTRAINT price_observations_bid_count_check
    CHECK (bid_count IS NULL OR bid_count >= 0),
  ADD CONSTRAINT price_observations_completed_evidence_check
    CHECK (
      observation_kind <> 'completed_auction'
      OR completed_auction_price_minor IS NOT NULL
      OR sold_price_minor IS NOT NULL
    ),
  ADD CONSTRAINT price_observations_confirmed_sold_evidence_check
    CHECK (
      observation_kind <> 'confirmed_sold'
      OR sold_price_minor IS NOT NULL
    );

CREATE INDEX price_observations_typed_trend_idx
  ON price_observations(
    listing_id,
    analytics_eligible,
    observation_kind,
    observed_at,
    observation_version
  );

CREATE INDEX price_observations_market_trend_idx
  ON price_observations(
    comparison_currency,
    source_marketplace,
    observation_kind,
    observed_at DESC
  )
  WHERE comparison_price_minor IS NOT NULL;

-- Per-watchlist alert policy. JSON keeps event additions forward compatible
-- while each outbound channel remains an explicit opt-in.
ALTER TABLE watchlists
  ADD COLUMN alert_event_types JSONB NOT NULL
    DEFAULT '["new_listing","price_drop","auction_ending"]'::jsonb,
  ADD COLUMN alert_in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN alert_email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN alert_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT watchlists_alert_event_types_check
    CHECK (jsonb_typeof(alert_event_types) = 'array');

ALTER TABLE alert_matches
  ADD COLUMN event_type TEXT NOT NULL DEFAULT 'new_listing',
  ADD COLUMN event_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT alert_matches_event_type_check
    CHECK (
      event_type IN (
        'new_listing',
        'price_drop',
        'auction_ending',
        'back_in_range',
        'digest',
        'security'
      )
    ),
  ADD CONSTRAINT alert_matches_event_context_check
    CHECK (jsonb_typeof(event_context) = 'object');

ALTER TABLE alert_matches
  DROP CONSTRAINT IF EXISTS alert_matches_watchlist_id_listing_id_key;

ALTER TABLE alert_matches
  ADD CONSTRAINT alert_matches_watchlist_listing_event_key
    UNIQUE (watchlist_id, listing_id, event_type);

ALTER TABLE alert_deliveries
  DROP CONSTRAINT IF EXISTS alert_deliveries_channel_check;

-- Some PostgreSQL-compatible test engines assign positional names to
-- unnamed CHECK constraints. The production name above remains canonical.
ALTER TABLE alert_deliveries
  DROP CONSTRAINT IF EXISTS alert_deliveries_constraint_1;

ALTER TABLE alert_deliveries
  ADD COLUMN event_type TEXT NOT NULL DEFAULT 'new_listing',
  ADD COLUMN template_key TEXT NOT NULL DEFAULT 'watchlist_match',
  ADD COLUMN payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN claimed_at TIMESTAMPTZ,
  ADD COLUMN provider_response JSONB,
  ADD COLUMN provider_delivery_status TEXT,
  ADD COLUMN provider_status_rank INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT alert_deliveries_channel_check
    CHECK (channel IN ('in_app', 'email', 'sms')),
  ADD CONSTRAINT alert_deliveries_event_type_check
    CHECK (
      event_type IN (
        'new_listing',
        'price_drop',
        'auction_ending',
        'back_in_range',
        'digest',
        'security'
      )
    ),
  ADD CONSTRAINT alert_deliveries_payload_check
    CHECK (jsonb_typeof(payload) = 'object'),
  ADD CONSTRAINT alert_deliveries_provider_response_check
    CHECK (
      provider_response IS NULL
      OR jsonb_typeof(provider_response) = 'object'
    ),
  ADD CONSTRAINT alert_deliveries_provider_status_rank_check
    CHECK (provider_status_rank >= 0),
  ADD CONSTRAINT alert_deliveries_provider_delivery_status_check
    CHECK (
      provider_delivery_status IS NULL
      OR provider_delivery_status IN (
        'accepted',
        'delivered',
        'failed',
        'queued',
        'sending',
        'sent',
        'undelivered'
      )
    );

CREATE TABLE user_phone_identities (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  normalized_phone_e164 TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id),
  CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CHECK (normalized_phone_e164 = phone_e164),
  CHECK (verified_at IS NULL OR verified_at >= created_at),
  CHECK (disabled_at IS NULL OR disabled_at >= created_at)
);

CREATE UNIQUE INDEX user_phone_identities_verified_phone_idx
  ON user_phone_identities(normalized_phone_e164)
  WHERE verified_at IS NOT NULL AND disabled_at IS NULL;

CREATE TABLE phone_verification_challenges (
  id UUID PRIMARY KEY,
  phone_identity_id UUID NOT NULL
    REFERENCES user_phone_identities(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (char_length(code_hash) BETWEEN 64 AND 256),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (attempt_count >= 0 AND attempt_count <= 10)
);

CREATE INDEX phone_verification_active_idx
  ON phone_verification_challenges(phone_identity_id, expires_at DESC)
  WHERE consumed_at IS NULL;

-- Destination-level throttling intentionally has no identity foreign key so
-- deleting/re-adding a phone cannot reset the cooldown.
CREATE TABLE phone_verification_rate_limits (
  destination_hash TEXT PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (char_length(destination_hash) = 64),
  CHECK (last_sent_at >= created_at)
);

-- Shared account-scoped abuse control; unlike an in-memory limiter this is
-- consistent across worker/API replicas and survives process restarts.
CREATE TABLE notification_actor_rate_limits (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, action),
  CHECK (char_length(btrim(action)) BETWEEN 1 AND 80),
  CHECK (attempt_count >= 1)
);

CREATE TABLE notification_channel_consents (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  destination_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  ip_hint_hash TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (channel IN ('email', 'sms')),
  CHECK (action IN ('opt_in', 'opt_out')),
  CHECK (char_length(destination_hash) BETWEEN 32 AND 256),
  CHECK (char_length(btrim(source)) BETWEEN 1 AND 80),
  CHECK (ip_hint_hash IS NULL OR char_length(ip_hint_hash) BETWEEN 32 AND 256),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX notification_channel_consents_lookup_idx
  ON notification_channel_consents(channel, destination_hash, occurred_at DESC);

CREATE TABLE notification_suppressions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  destination_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  provider_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (channel IN ('email', 'sms')),
  CHECK (
    reason IN (
      'bounce',
      'complaint',
      'invalid_destination',
      'unsubscribe',
      'sms_stop',
      'manual'
    )
  ),
  CHECK (char_length(destination_hash) BETWEEN 32 AND 256),
  CHECK (released_at IS NULL OR released_at >= created_at),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX notification_suppressions_active_idx
  ON notification_suppressions(channel, destination_hash)
  WHERE released_at IS NULL;

CREATE TABLE notification_unsubscribe_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (char_length(token_hash) BETWEEN 64 AND 256),
  CHECK (char_length(destination_hash) = 64),
  CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX notification_unsubscribe_tokens_active_idx
  ON notification_unsubscribe_tokens(token_hash, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE notification_webhook_events (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processing_started_at TIMESTAMPTZ,
  processing_claim_token UUID,
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, provider_event_id),
  CHECK (provider IN ('resend', 'twilio')),
  CHECK (char_length(btrim(event_type)) BETWEEN 1 AND 120),
  CHECK (char_length(payload_digest) = 64),
  CHECK (
    processing_started_at IS NULL
    OR processing_started_at >= received_at
  ),
  CHECK (
    (processing_started_at IS NULL) = (processing_claim_token IS NULL)
  ),
  CHECK (processed_at IS NULL OR processed_at >= received_at)
);

CREATE INDEX notification_webhook_events_recovery_idx
  ON notification_webhook_events(processing_started_at)
  WHERE processed_at IS NULL;

CREATE INDEX alert_deliveries_claim_recovery_idx
  ON alert_deliveries(claimed_at)
  WHERE status = 'processing';
