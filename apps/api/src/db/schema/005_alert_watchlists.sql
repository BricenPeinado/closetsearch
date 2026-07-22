ALTER TABLE watchlists ADD COLUMN category TEXT;
ALTER TABLE watchlists ADD COLUMN listing_type TEXT;
ALTER TABLE watchlists ADD COLUMN min_price_amount INTEGER;
ALTER TABLE watchlists ADD COLUMN max_price_amount INTEGER;
UPDATE watchlists
SET max_price_amount = max_price
WHERE max_price_amount IS NULL AND max_price IS NOT NULL;
ALTER TABLE watchlists ADD COLUMN price_currency TEXT;
UPDATE watchlists
SET price_currency = 'USD'
WHERE price_currency IS NULL
  AND (min_price_amount IS NOT NULL OR max_price_amount IS NOT NULL OR max_price IS NOT NULL);
ALTER TABLE watchlists ADD COLUMN condition TEXT;
ALTER TABLE watchlists ADD COLUMN size TEXT;
ALTER TABLE watchlists ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY,
  email_enabled INTEGER NOT NULL DEFAULT 0,
  push_enabled INTEGER NOT NULL DEFAULT 0,
  sms_enabled INTEGER NOT NULL DEFAULT 0,
  in_app_enabled INTEGER NOT NULL DEFAULT 1,
  frequency TEXT NOT NULL DEFAULT 'daily',
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS notification_preferences_frequency_idx
  ON notification_preferences(frequency, updated_at DESC);

CREATE TABLE IF NOT EXISTS alert_matches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  watchlist_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_listing_id TEXT NOT NULL,
  matched_reason_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  first_matched_at TEXT NOT NULL,
  last_matched_at TEXT NOT NULL,
  dismissed_at TEXT,
  UNIQUE(watchlist_id, listing_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS alert_matches_user_status_idx
  ON alert_matches(user_id, status, last_matched_at DESC);

CREATE INDEX IF NOT EXISTS alert_matches_source_listing_idx
  ON alert_matches(source, source_listing_id, last_matched_at DESC);
