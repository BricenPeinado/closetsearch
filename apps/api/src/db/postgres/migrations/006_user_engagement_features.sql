CREATE TABLE user_listing_engagement_daily (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  view_count BIGINT NOT NULL DEFAULT 0,
  open_count BIGINT NOT NULL DEFAULT 0,
  like_count BIGINT NOT NULL DEFAULT 0,
  unlike_count BIGINT NOT NULL DEFAULT 0,
  hide_count BIGINT NOT NULL DEFAULT 0,
  conversion_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, listing_id, event_date),
  CHECK (
    view_count >= 0
    AND open_count >= 0
    AND like_count >= 0
    AND unlike_count >= 0
    AND hide_count >= 0
    AND conversion_count >= 0
  )
);

CREATE INDEX user_listing_engagement_daily_user_date_idx
  ON user_listing_engagement_daily(user_id, event_date DESC, listing_id);

COMMENT ON TABLE user_listing_engagement_daily IS
  'Privacy-scoped daily features derived by the worker; feed requests do not scan raw engagement events.';
