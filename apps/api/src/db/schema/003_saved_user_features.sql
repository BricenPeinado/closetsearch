ALTER TABLE likes ADD COLUMN listing_snapshot_json TEXT;

ALTER TABLE saved_searches ADD COLUMN updated_at TEXT;
UPDATE saved_searches
SET updated_at = created_at
WHERE updated_at IS NULL;

CREATE TABLE IF NOT EXISTS saved_filters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  params_key TEXT NOT NULL,
  query_text TEXT,
  source_filter TEXT,
  listing_type_filter TEXT,
  min_price INTEGER,
  max_price INTEGER,
  sort_mode TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, params_key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS saved_filters_user_id_idx
  ON saved_filters(user_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  query_text TEXT,
  brand TEXT,
  max_price INTEGER,
  source_filter TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS watchlists_user_id_idx
  ON watchlists(user_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  default_sort_mode TEXT,
  preferred_sources_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
