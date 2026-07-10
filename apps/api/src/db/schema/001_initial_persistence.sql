CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  currency_preference TEXT NOT NULL,
  onboarding_preferences_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, listing_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS likes_user_id_idx ON likes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recent_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  params TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, params),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS recent_searches_user_id_idx
  ON recent_searches(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  params TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, params),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS saved_searches_user_id_idx
  ON saved_searches(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS listing_cache (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_listing_id TEXT NOT NULL,
  listing_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(source, source_listing_id)
);

CREATE INDEX IF NOT EXISTS listing_cache_source_idx
  ON listing_cache(source, source_listing_id);
