CREATE TABLE ml_training_datasets (
  id UUID PRIMARY KEY,
  dataset_kind TEXT NOT NULL,
  feature_schema_version TEXT NOT NULL,
  snapshot_uri TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  row_count BIGINT NOT NULL,
  exclusion_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (dataset_kind IN ('recommendation', 'market_value')),
  CHECK (char_length(feature_schema_version) BETWEEN 1 AND 80),
  CHECK (char_length(snapshot_sha256) = 64),
  CHECK (row_count >= 0),
  CHECK (jsonb_typeof(exclusion_counts) = 'object')
);

CREATE TABLE ml_feature_snapshots (
  id UUID PRIMARY KEY,
  dataset_id UUID REFERENCES ml_training_datasets(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  feature_schema_version TEXT NOT NULL,
  features JSONB NOT NULL,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (entity_type IN ('user', 'listing', 'segment', 'global')),
  CHECK (char_length(feature_schema_version) BETWEEN 1 AND 80),
  CHECK (jsonb_typeof(features) = 'object'),
  CHECK (window_start IS NULL OR window_end >= window_start)
);

CREATE INDEX ml_feature_snapshots_entity_idx
  ON ml_feature_snapshots(entity_type, entity_id, window_end DESC);

CREATE TABLE ml_model_versions (
  id UUID PRIMARY KEY,
  model_kind TEXT NOT NULL,
  version TEXT NOT NULL,
  feature_schema_version TEXT NOT NULL,
  training_dataset_id UUID NOT NULL REFERENCES ml_training_datasets(id) ON DELETE RESTRICT,
  artifact_uri TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  metrics JSONB NOT NULL,
  segment_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'candidate',
  trained_at TIMESTAMPTZ NOT NULL,
  promoted_at TIMESTAMPTZ,
  stale_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (model_kind, version),
  CHECK (model_kind IN ('recommendation', 'market_value')),
  CHECK (char_length(version) BETWEEN 1 AND 120),
  CHECK (char_length(feature_schema_version) BETWEEN 1 AND 80),
  CHECK (char_length(artifact_sha256) = 64),
  CHECK (jsonb_typeof(metrics) = 'object'),
  CHECK (jsonb_typeof(segment_metrics) = 'object'),
  CHECK (status IN ('candidate', 'shadow', 'active', 'rejected', 'retired', 'stale')),
  CHECK (promoted_at IS NULL OR promoted_at >= trained_at),
  CHECK (stale_at IS NULL OR stale_at >= trained_at)
);

CREATE INDEX ml_model_versions_active_idx
  ON ml_model_versions(model_kind, status, promoted_at DESC);

CREATE TABLE ml_predictions (
  id UUID PRIMARY KEY,
  prediction_kind TEXT NOT NULL,
  model_version_id UUID REFERENCES ml_model_versions(id) ON DELETE SET NULL,
  feature_schema_version TEXT NOT NULL,
  request_id UUID NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  ranked_position INTEGER,
  comparison_currency TEXT,
  predicted_value_minor BIGINT,
  interval_low_minor BIGINT,
  interval_high_minor BIGINT,
  confidence NUMERIC(8, 7),
  comparable_count INTEGER,
  reason_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  CHECK (prediction_kind IN ('recommendation', 'market_value')),
  CHECK (char_length(feature_schema_version) BETWEEN 1 AND 80),
  CHECK (ranked_position IS NULL OR ranked_position >= 0),
  CHECK (comparison_currency IS NULL OR comparison_currency ~ '^[A-Z]{3}$'),
  CHECK (predicted_value_minor IS NULL OR predicted_value_minor >= 0),
  CHECK (interval_low_minor IS NULL OR interval_low_minor >= 0),
  CHECK (interval_high_minor IS NULL OR interval_high_minor >= 0),
  CHECK (
    interval_low_minor IS NULL
    OR interval_high_minor IS NULL
    OR interval_high_minor >= interval_low_minor
  ),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CHECK (comparable_count IS NULL OR comparable_count >= 0),
  CHECK (jsonb_typeof(reason_metadata) = 'object'),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX ml_predictions_request_idx
  ON ml_predictions(request_id, ranked_position, created_at);

CREATE INDEX ml_predictions_listing_idx
  ON ml_predictions(listing_id, prediction_kind, created_at DESC)
  WHERE listing_id IS NOT NULL;

CREATE TABLE audit_records (
  audit_version BIGSERIAL PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (actor_type IN ('user', 'admin', 'worker', 'system', 'provider')),
  CHECK (char_length(action) BETWEEN 1 AND 160),
  CHECK (char_length(resource_type) BETWEEN 1 AND 120),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_records_resource_idx
  ON audit_records(resource_type, resource_id, occurred_at DESC);

CREATE INDEX audit_records_actor_idx
  ON audit_records(actor_type, actor_id, occurred_at DESC);

CREATE TABLE maintenance_runs (
  id UUID PRIMARY KEY,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  records_affected BIGINT,
  manifest_sha256 TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  CHECK (operation IN ('retention', 'backup', 'restore_test', 'schema_drift_check')),
  CHECK (status IN ('running', 'succeeded', 'failed')),
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  CHECK (records_affected IS NULL OR records_affected >= 0),
  CHECK (manifest_sha256 IS NULL OR char_length(manifest_sha256) = 64),
  CHECK (jsonb_typeof(metadata) = 'object')
);
