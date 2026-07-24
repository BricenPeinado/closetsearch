CREATE TABLE brands (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (slug = lower(btrim(slug))),
  CHECK (char_length(slug) BETWEEN 1 AND 160),
  CHECK (char_length(btrim(canonical_name)) BETWEEN 1 AND 200)
);

CREATE TABLE brand_aliases (
  id UUID PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  normalized_alias TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'maintained',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (normalized_alias = lower(btrim(normalized_alias))),
  CHECK (char_length(normalized_alias) BETWEEN 1 AND 200),
  CHECK (char_length(btrim(source)) BETWEEN 1 AND 64)
);

CREATE INDEX brand_aliases_brand_idx ON brand_aliases(brand_id);

CREATE TABLE listings (
  id UUID PRIMARY KEY,
  provider_id TEXT NOT NULL,
  source_marketplace TEXT NOT NULL,
  source_listing_id TEXT NOT NULL,
  canonical_fingerprint TEXT,
  title TEXT NOT NULL,
  canonical_brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
  provider_brand TEXT,
  category TEXT,
  size TEXT,
  condition TEXT,
  listing_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  seller_metadata JSONB,
  shipping_metadata JSONB,
  original_price_minor BIGINT NOT NULL,
  original_currency TEXT NOT NULL,
  comparison_price_minor BIGINT,
  comparison_currency TEXT,
  exchange_rate_source TEXT,
  exchange_rate_observed_at TIMESTAMPTZ,
  shipping_price_minor BIGINT,
  shipping_currency TEXT,
  landed_price_minor BIGINT,
  landed_currency TEXT,
  listed_at TIMESTAMPTZ,
  provider_updated_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL,
  analytics_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  raw_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider_id, source_listing_id),
  CHECK (char_length(btrim(provider_id)) BETWEEN 1 AND 80),
  CHECK (char_length(btrim(source_marketplace)) BETWEEN 1 AND 120),
  CHECK (char_length(btrim(source_listing_id)) BETWEEN 1 AND 256),
  CHECK (char_length(btrim(title)) BETWEEN 1 AND 1000),
  CHECK (listing_type IN ('buy_now', 'auction', 'offer', 'unknown')),
  CHECK (source_url ~ '^https?://'),
  CHECK (original_price_minor >= 0),
  CHECK (original_currency ~ '^[A-Z]{3}$'),
  CHECK (
    (comparison_price_minor IS NULL AND comparison_currency IS NULL)
    OR (
      comparison_price_minor >= 0
      AND comparison_currency ~ '^[A-Z]{3}$'
    )
  ),
  CHECK (
    (exchange_rate_source IS NULL AND exchange_rate_observed_at IS NULL)
    OR (
      exchange_rate_source IS NOT NULL
      AND exchange_rate_observed_at IS NOT NULL
      AND comparison_price_minor IS NOT NULL
    )
  ),
  CHECK (
    (shipping_price_minor IS NULL AND shipping_currency IS NULL)
    OR (shipping_price_minor >= 0 AND shipping_currency ~ '^[A-Z]{3}$')
  ),
  CHECK (
    (landed_price_minor IS NULL AND landed_currency IS NULL)
    OR (landed_price_minor >= 0 AND landed_currency ~ '^[A-Z]{3}$')
  )
);

CREATE INDEX listings_active_candidate_idx
  ON listings(analytics_eligible, fetched_at DESC, id);

CREATE INDEX listings_provider_updated_idx
  ON listings(provider_id, provider_updated_at DESC, source_listing_id);

CREATE INDEX listings_brand_category_idx
  ON listings(canonical_brand_id, category, fetched_at DESC);

CREATE INDEX listings_canonical_fingerprint_idx
  ON listings(canonical_fingerprint)
  WHERE canonical_fingerprint IS NOT NULL;

CREATE TABLE listing_images (
  id UUID PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (listing_id, ordinal),
  UNIQUE (listing_id, image_url),
  CHECK (ordinal >= 0),
  CHECK (image_url ~ '^https?://'),
  CHECK (width IS NULL OR width > 0),
  CHECK (height IS NULL OR height > 0)
);

CREATE INDEX listing_images_listing_idx
  ON listing_images(listing_id, ordinal);

CREATE TABLE listing_current_state (
  listing_id UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  market_status TEXT NOT NULL,
  availability TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  stale_after TIMESTAMPTZ,
  sold_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  unavailable_at TIMESTAMPTZ,
  lifecycle_version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (market_status IN ('active', 'sold', 'unknown')),
  CHECK (availability IN ('available', 'stale', 'sold', 'removed', 'unavailable')),
  CHECK (last_seen_at >= first_seen_at),
  CHECK (stale_after IS NULL OR stale_after >= first_seen_at),
  CHECK (sold_at IS NULL OR sold_at >= first_seen_at),
  CHECK (removed_at IS NULL OR removed_at >= first_seen_at),
  CHECK (unavailable_at IS NULL OR unavailable_at >= first_seen_at),
  CHECK (lifecycle_version > 0)
);

CREATE INDEX listing_current_state_feed_idx
  ON listing_current_state(availability, market_status, last_seen_at DESC, listing_id);

CREATE INDEX listing_current_state_staleness_idx
  ON listing_current_state(stale_after, availability)
  WHERE availability = 'available';

CREATE TABLE listing_state_transitions (
  transition_version BIGSERIAL PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  from_availability TEXT,
  to_availability TEXT NOT NULL,
  from_market_status TEXT,
  to_market_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  ingestion_event_id UUID,
  CHECK (
    from_availability IS NULL
    OR from_availability IN ('available', 'stale', 'sold', 'removed', 'unavailable')
  ),
  CHECK (to_availability IN ('available', 'stale', 'sold', 'removed', 'unavailable')),
  CHECK (
    from_market_status IS NULL
    OR from_market_status IN ('active', 'sold', 'unknown')
  ),
  CHECK (to_market_status IN ('active', 'sold', 'unknown')),
  CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200)
);

CREATE INDEX listing_state_transitions_listing_idx
  ON listing_state_transitions(listing_id, transition_version DESC);

CREATE TABLE currency_rates (
  id UUID PRIMARY KEY,
  rate_source TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate NUMERIC(24, 12) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (rate_source, base_currency, quote_currency, observed_at),
  CHECK (base_currency ~ '^[A-Z]{3}$'),
  CHECK (quote_currency ~ '^[A-Z]{3}$'),
  CHECK (base_currency <> quote_currency),
  CHECK (rate > 0),
  CHECK (expires_at > observed_at)
);

CREATE INDEX currency_rates_latest_idx
  ON currency_rates(base_currency, quote_currency, observed_at DESC);

CREATE TABLE price_observations (
  observation_version BIGSERIAL PRIMARY KEY,
  observation_id UUID NOT NULL UNIQUE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  original_price_minor BIGINT NOT NULL,
  original_currency TEXT NOT NULL,
  comparison_price_minor BIGINT,
  comparison_currency TEXT,
  sold_price_minor BIGINT,
  sold_currency TEXT,
  shipping_price_minor BIGINT,
  shipping_currency TEXT,
  market_status TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  exchange_rate_id UUID REFERENCES currency_rates(id) ON DELETE SET NULL,
  UNIQUE (listing_id, idempotency_key),
  CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  CHECK (original_price_minor >= 0),
  CHECK (original_currency ~ '^[A-Z]{3}$'),
  CHECK (
    (comparison_price_minor IS NULL AND comparison_currency IS NULL)
    OR (comparison_price_minor >= 0 AND comparison_currency ~ '^[A-Z]{3}$')
  ),
  CHECK (
    (sold_price_minor IS NULL AND sold_currency IS NULL)
    OR (sold_price_minor >= 0 AND sold_currency ~ '^[A-Z]{3}$')
  ),
  CHECK (
    (shipping_price_minor IS NULL AND shipping_currency IS NULL)
    OR (shipping_price_minor >= 0 AND shipping_currency ~ '^[A-Z]{3}$')
  ),
  CHECK (market_status IN ('active', 'sold', 'unknown'))
);

CREATE INDEX price_observations_listing_latest_idx
  ON price_observations(listing_id, observation_version DESC);

CREATE INDEX price_observations_comparables_idx
  ON price_observations(comparison_currency, market_status, observed_at DESC, listing_id)
  WHERE comparison_price_minor IS NOT NULL;

CREATE TABLE provider_ingestion_checkpoints (
  id UUID PRIMARY KEY,
  provider_id TEXT NOT NULL,
  ingestion_scope TEXT NOT NULL,
  query_key TEXT NOT NULL,
  continuation_cursor JSONB,
  checkpoint_version BIGINT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider_id, ingestion_scope, query_key),
  CHECK (ingestion_scope IN ('active', 'sold', 'refresh', 'watchlist')),
  CHECK (char_length(query_key) BETWEEN 1 AND 512),
  CHECK (checkpoint_version >= 0),
  CHECK (consecutive_failures >= 0)
);

CREATE INDEX provider_ingestion_checkpoints_due_idx
  ON provider_ingestion_checkpoints(next_run_at, consecutive_failures, provider_id);

CREATE TABLE provider_health (
  provider_id TEXT PRIMARY KEY,
  health_state TEXT NOT NULL,
  last_checked_at TIMESTAMPTZ NOT NULL,
  last_success_at TIMESTAMPTZ,
  latency_ms INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  rate_limited_until TIMESTAMPTZ,
  circuit_open_until TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (health_state IN ('healthy', 'degraded', 'unavailable', 'disabled', 'blocked')),
  CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CHECK (consecutive_failures >= 0),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX provider_health_state_idx
  ON provider_health(health_state, last_checked_at DESC);

CREATE TABLE listing_ingestion_events (
  id UUID PRIMARY KEY,
  provider_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  result TEXT,
  UNIQUE (provider_id, idempotency_key),
  CHECK (char_length(provider_id) BETWEEN 1 AND 80),
  CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  CHECK (result IS NULL OR result IN ('inserted', 'updated', 'unchanged', 'ignored_stale')),
  CHECK (processed_at IS NULL OR processed_at >= received_at)
);

CREATE INDEX listing_ingestion_events_retention_idx
  ON listing_ingestion_events(received_at, provider_id);

CREATE TABLE worker_jobs (
  id UUID PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  checkpoint JSONB,
  status TEXT NOT NULL DEFAULT 'queued',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL,
  schedule_interval_seconds INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_succeeded_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (char_length(job_key) BETWEEN 1 AND 256),
  CHECK (char_length(job_type) BETWEEN 1 AND 120),
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (checkpoint IS NULL OR jsonb_typeof(checkpoint) IN ('object', 'array', 'string', 'number')),
  CHECK (status IN ('queued', 'running', 'retry_wait', 'succeeded', 'paused', 'dead_letter')),
  CHECK (priority BETWEEN -1000 AND 1000),
  CHECK (schedule_interval_seconds IS NULL OR schedule_interval_seconds > 0),
  CHECK (attempt_count >= 0),
  CHECK (consecutive_failures >= 0),
  CHECK (max_attempts > 0),
  CHECK (
    (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX worker_jobs_claim_idx
  ON worker_jobs(enabled, run_after, priority DESC, id)
  WHERE status IN ('queued', 'retry_wait', 'running');

CREATE INDEX worker_jobs_lease_idx
  ON worker_jobs(lease_expires_at, lease_owner)
  WHERE lease_token IS NOT NULL;

CREATE TABLE worker_job_runs (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES worker_jobs(id) ON DELETE CASCADE,
  lease_token UUID NOT NULL,
  worker_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  checkpoint_before JSONB,
  checkpoint_after JSONB,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job_id, lease_token),
  CHECK (status IN ('running', 'succeeded', 'failed', 'abandoned')),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX worker_job_runs_job_idx
  ON worker_job_runs(job_id, started_at DESC);
