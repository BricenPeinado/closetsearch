CREATE TABLE IF NOT EXISTS price_snapshots (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_listing_id TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  title TEXT,
  price_amount INTEGER NOT NULL,
  price_currency TEXT NOT NULL,
  normalized_price_amount INTEGER NOT NULL,
  normalized_price_currency TEXT NOT NULL,
  condition TEXT,
  size TEXT,
  listing_type TEXT NOT NULL,
  market_status TEXT NOT NULL,
  source_url TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  listing_json TEXT,
  UNIQUE(source, source_listing_id, normalized_price_amount, normalized_price_currency, market_status)
);

CREATE INDEX IF NOT EXISTS price_snapshots_listing_lookup_idx
  ON price_snapshots(source, source_listing_id, observed_at DESC, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS price_snapshots_brand_idx
  ON price_snapshots(brand, normalized_price_currency, observed_at DESC);

CREATE INDEX IF NOT EXISTS price_snapshots_category_idx
  ON price_snapshots(category, normalized_price_currency, observed_at DESC);

CREATE INDEX IF NOT EXISTS price_snapshots_market_status_idx
  ON price_snapshots(market_status, observed_at DESC, last_seen_at DESC);
