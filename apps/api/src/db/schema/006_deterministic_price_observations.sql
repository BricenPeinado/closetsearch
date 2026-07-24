ALTER TABLE price_snapshots RENAME TO price_snapshots_legacy;

CREATE TABLE price_snapshots (
  observation_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
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
  listing_json TEXT
);

INSERT INTO price_snapshots (
  id,
  listing_id,
  source,
  source_listing_id,
  brand,
  category,
  title,
  price_amount,
  price_currency,
  normalized_price_amount,
  normalized_price_currency,
  condition,
  size,
  listing_type,
  market_status,
  source_url,
  observed_at,
  last_seen_at,
  listing_json
)
SELECT
  id,
  listing_id,
  source,
  source_listing_id,
  brand,
  category,
  title,
  price_amount,
  price_currency,
  normalized_price_amount,
  normalized_price_currency,
  condition,
  size,
  listing_type,
  market_status,
  source_url,
  observed_at,
  last_seen_at,
  listing_json
FROM price_snapshots_legacy
ORDER BY observed_at, last_seen_at, id;

DROP TABLE price_snapshots_legacy;

CREATE INDEX price_snapshots_listing_lookup_idx
  ON price_snapshots(source, source_listing_id, observation_sequence DESC);

CREATE INDEX price_snapshots_brand_idx
  ON price_snapshots(
    brand,
    normalized_price_currency,
    observation_sequence DESC
  );

CREATE INDEX price_snapshots_category_idx
  ON price_snapshots(
    category,
    normalized_price_currency,
    observation_sequence DESC
  );

CREATE INDEX price_snapshots_market_status_idx
  ON price_snapshots(market_status, observation_sequence DESC);
