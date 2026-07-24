import { randomUUID } from "node:crypto";
import type {
  Like,
  NotificationPreferences,
  PersistSavedFilterInput,
  PersistSearchHistoryInput,
  PersistWatchlistInput,
  RecentSearch,
  SavedFilter,
  SavedSearch,
  UpdateNotificationPreferencesInput,
  UpdateWatchlistInput,
  Watchlist,
} from "@closetsearch/shared";
import type { QueryResultRow } from "pg";
import type { PgQueryable } from "../types.js";
import {
  assertUuid,
  normalizeBoundedString,
  normalizeCurrency,
  parseJsonArray,
  parseJsonObject,
  requiredBoundedString,
  sha256,
  stableSerialize,
  toIso,
  validateQuietHours,
} from "../request-store-common.js";
import { formatPublicListingId, parsePublicListingId } from "../public-listing-id.js";
import { RequestStoreError } from "../request-store-types.js";

interface LikeRow extends QueryResultRow {
  created_at: Date | string;
  id: string;
  provider_id: string;
  source_listing_id: string;
  source_marketplace: string;
  user_id: string;
}

interface SearchRow extends QueryResultRow {
  created_at: Date | string;
  id: string;
  query: unknown;
  user_id: string;
}

interface SavedFilterRow extends QueryResultRow {
  created_at: Date | string;
  filters: unknown;
  id: string;
  label: string;
  updated_at: Date | string;
  user_id: string;
}

interface WatchlistRow extends QueryResultRow {
  brand_text: string | null;
  category: string | null;
  condition: string | null;
  created_at: Date | string;
  enabled: boolean;
  id: string;
  label: string;
  listing_type: string | null;
  max_price_minor: bigint | number | string | null;
  min_price_minor: bigint | number | string | null;
  price_currency: string | null;
  query_text: string | null;
  size: string | null;
  source_marketplace: string | null;
  updated_at: Date | string;
  user_id: string;
}

interface NotificationRow extends QueryResultRow {
  created_at: Date | string;
  email_enabled: boolean;
  frequency: string;
  in_app_enabled: boolean;
  push_enabled: boolean;
  quiet_hours_end: string | null;
  quiet_hours_start: string | null;
  sms_enabled: boolean;
  updated_at: Date | string;
  user_id: string;
}

const likeSelect = `
  SELECT
    lk.id,
    lk.user_id,
    lk.created_at,
    l.provider_id,
    l.source_listing_id,
    l.source_marketplace
  FROM likes lk
  JOIN listings l ON l.id = lk.listing_id
`;

const recentSearchSelect = `
  SELECT
    id,
    user_id,
    query,
    submitted_at AS created_at
  FROM recent_searches
`;

const savedSearchSelect = `
  SELECT
    id,
    user_id,
    query,
    created_at
  FROM saved_searches
`;

const savedFilterSelect = `
  SELECT
    id,
    user_id,
    label,
    filters,
    created_at,
    updated_at
  FROM saved_filters
`;

const watchlistSelect = `
  SELECT
    id,
    user_id,
    label,
    query_text,
    brand_text,
    category,
    source_marketplace,
    listing_type,
    min_price_minor,
    max_price_minor,
    price_currency,
    condition,
    size,
    enabled,
    created_at,
    updated_at
  FROM watchlists
`;

const notificationSelect = `
  SELECT
    user_id,
    email_enabled,
    push_enabled,
    sms_enabled,
    in_app_enabled,
    frequency,
    quiet_hours_start,
    quiet_hours_end,
    created_at,
    updated_at
  FROM notification_preferences
`;

const zeroFractionCurrencies = new Set(["CLP", "JPY", "KRW", "VND"]);
const threeFractionCurrencies = new Set(["BHD", "IQD", "JOD", "KWD", "OMR", "TND"]);

function currencyFractionDigits(currency: string) {
  if (zeroFractionCurrencies.has(currency)) {
    return 0;
  }

  if (threeFractionCurrencies.has(currency)) {
    return 3;
  }

  return 2;
}

function toMinorUnits(value: number | undefined, currency: string, label: string) {
  if (value === undefined) {
    return undefined;
  }

  const amountMinor = Math.round(value * 10 ** currencyFractionDigits(currency));

  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(amountMinor)) {
    throw new RequestStoreError(
      "invalid_watchlist",
      `${label} must be a nonnegative exact amount.`,
    );
  }

  return BigInt(amountMinor);
}

function fromMinorUnits(value: bigint | number | string | null, currency: string | null) {
  if (value === null || !currency) {
    return undefined;
  }

  return Number(BigInt(value)) / 10 ** currencyFractionDigits(currency);
}

function mapLike(row: LikeRow): Like {
  return {
    createdAt: toIso(row.created_at),
    id: row.id,
    listingId: formatPublicListingId(row.provider_id, row.source_listing_id),
    source: row.source_marketplace,
    userId: row.user_id,
  };
}

function mapSearch(row: SearchRow): RecentSearch | SavedSearch {
  const query = parseJsonObject(row.query);

  return {
    createdAt: toIso(row.created_at),
    description: typeof query.description === "string" ? query.description : "",
    id: row.id,
    label: typeof query.label === "string" ? query.label : "",
    params: typeof query.params === "string" ? query.params : "",
    userId: row.user_id,
  };
}

function normalizeSearchParams(params: string) {
  if (
    params.trim().length === 0 ||
    params.length > 8_192 ||
    Array.from(params).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new RequestStoreError(
      "invalid_saved_feature",
      "Search parameters must contain between 1 and 8192 safe characters.",
    );
  }

  return params;
}

function normalizeSearch(input: PersistSearchHistoryInput) {
  const params = normalizeSearchParams(input.params);

  return {
    description: normalizeBoundedString(input.description, 1_000) ?? "",
    label: requiredBoundedString(input.label, 160, "invalid_saved_feature", "Search label"),
    params,
  };
}

function normalizeOptionalPrice(value: number | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new RequestStoreError(
      "invalid_saved_feature",
      "Saved-filter prices must be nonnegative numbers.",
    );
  }

  return Math.trunc(value);
}

function normalizeSavedFilter(input: PersistSavedFilterInput) {
  const listingType =
    input.listingType === "auction" || input.listingType === "buy_now"
      ? input.listingType
      : undefined;
  const sortMode =
    input.sortMode === "newest" ||
    input.sortMode === "price_asc" ||
    input.sortMode === "price_desc" ||
    input.sortMode === "relevance"
      ? input.sortMode
      : undefined;
  const filters = {
    listingType,
    maxPrice: normalizeOptionalPrice(input.maxPrice),
    minPrice: normalizeOptionalPrice(input.minPrice),
    queryText: normalizeBoundedString(input.queryText, 500),
    sortMode,
    source: normalizeBoundedString(input.source, 80),
  };

  if (
    filters.minPrice !== undefined &&
    filters.maxPrice !== undefined &&
    filters.maxPrice < filters.minPrice
  ) {
    throw new RequestStoreError(
      "invalid_saved_feature",
      "Saved-filter maximum price cannot be below minimum price.",
    );
  }

  return {
    filterHash: sha256("saved-filter-v1", stableSerialize(filters)),
    filters,
    label: requiredBoundedString(input.label, 160, "invalid_saved_feature", "Saved-filter label"),
  };
}

function mapSavedFilter(row: SavedFilterRow): SavedFilter {
  const filters = parseJsonObject(row.filters);
  const listingType =
    filters.listingType === "auction" || filters.listingType === "buy_now"
      ? filters.listingType
      : undefined;
  const sortMode =
    filters.sortMode === "newest" ||
    filters.sortMode === "price_asc" ||
    filters.sortMode === "price_desc" ||
    filters.sortMode === "relevance"
      ? filters.sortMode
      : undefined;

  return {
    createdAt: toIso(row.created_at),
    id: row.id,
    label: row.label,
    listingType,
    maxPrice: typeof filters.maxPrice === "number" ? filters.maxPrice : undefined,
    minPrice: typeof filters.minPrice === "number" ? filters.minPrice : undefined,
    queryText: typeof filters.queryText === "string" ? filters.queryText : undefined,
    sortMode,
    source: typeof filters.source === "string" ? filters.source : undefined,
    updatedAt: toIso(row.updated_at),
    userId: row.user_id,
  };
}

function mapWatchlist(row: WatchlistRow): Watchlist {
  return {
    brand: row.brand_text ?? undefined,
    category: row.category ?? undefined,
    condition:
      row.condition === "new_with_tags" ||
      row.condition === "new_without_tags" ||
      row.condition === "excellent" ||
      row.condition === "good" ||
      row.condition === "fair" ||
      row.condition === "unknown"
        ? row.condition
        : undefined,
    createdAt: toIso(row.created_at),
    enabled: row.enabled,
    id: row.id,
    label: row.label,
    listingType:
      row.listing_type === "auction" || row.listing_type === "buy_now"
        ? row.listing_type
        : undefined,
    maxPriceAmount: fromMinorUnits(row.max_price_minor, row.price_currency),
    minPriceAmount: fromMinorUnits(row.min_price_minor, row.price_currency),
    priceCurrency: row.price_currency ?? undefined,
    queryText: row.query_text ?? undefined,
    size: row.size ?? undefined,
    source: row.source_marketplace ?? undefined,
    updatedAt: toIso(row.updated_at),
    userId: row.user_id,
  };
}

function mapNotification(row: NotificationRow): NotificationPreferences {
  return {
    createdAt: toIso(row.created_at),
    emailEnabled: row.email_enabled,
    frequency: row.frequency === "instant" || row.frequency === "weekly" ? row.frequency : "daily",
    inAppEnabled: row.in_app_enabled,
    pushEnabled: row.push_enabled,
    quietHoursEnd: row.quiet_hours_end?.slice(0, 5) || undefined,
    quietHoursStart: row.quiet_hours_start?.slice(0, 5) || undefined,
    smsEnabled: row.sms_enabled,
    updatedAt: toIso(row.updated_at),
    userId: row.user_id,
  };
}

function meaningfulWatchlist(input: PersistWatchlistInput) {
  return Boolean(
    input.queryText ||
    input.brand ||
    input.category ||
    input.source ||
    input.listingType ||
    input.minPriceAmount !== undefined ||
    input.maxPriceAmount !== undefined ||
    input.condition ||
    input.size,
  );
}

export class RequestFeatureRepository {
  constructor(private readonly queryable: PgQueryable) {}

  async listLikes(userId: string) {
    const result = await this.queryable.query<LikeRow>(
      `${likeSelect}
       WHERE lk.user_id = $1
       ORDER BY lk.created_at DESC, lk.id DESC`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows.map(mapLike);
  }

  async upsertLike(input: { createdAt?: Date; id?: string; listingId: string; userId: string }) {
    const publicListing = parsePublicListingId(input.listingId);

    if (!publicListing) {
      throw new RequestStoreError(
        "invalid_identifier",
        "Listing ID must use provider:source-listing-id format.",
      );
    }

    const listing = await this.queryable.query<{ id: string }>(
      `SELECT id
       FROM listings
       WHERE provider_id = $1
         AND source_listing_id = $2`,
      [publicListing.providerId, publicListing.sourceListingId],
    );

    if (!listing.rows[0]) {
      throw new RequestStoreError(
        "listing_not_persisted",
        "Listing must be persisted before it can be liked.",
      );
    }

    await this.queryable.query(
      `INSERT INTO likes (
         id,
         user_id,
         listing_id,
         created_at
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, listing_id) DO NOTHING`,
      [
        input.id ? assertUuid(input.id, "Like ID") : randomUUID(),
        assertUuid(input.userId, "User ID"),
        listing.rows[0].id,
        input.createdAt ?? new Date(),
      ],
    );
    const result = await this.queryable.query<LikeRow>(
      `${likeSelect}
       WHERE lk.user_id = $1
         AND lk.listing_id = $2`,
      [input.userId, listing.rows[0].id],
    );

    return mapLike(result.rows[0]);
  }

  async deleteLike(input: { id?: string; listingId?: string; userId: string }) {
    const userId = assertUuid(input.userId, "User ID");

    if (input.id) {
      const result = await this.queryable.query(
        `DELETE FROM likes
         WHERE user_id = $1
           AND id = $2`,
        [userId, assertUuid(input.id, "Like ID")],
      );
      return result.rowCount === 1;
    }

    const publicListing = input.listingId ? parsePublicListingId(input.listingId) : undefined;

    if (!publicListing) {
      throw new RequestStoreError(
        "invalid_identifier",
        "Like ID or normalized listing ID is required.",
      );
    }

    const result = await this.queryable.query(
      `DELETE FROM likes
       WHERE user_id = $1
         AND listing_id = (
           SELECT id
           FROM listings
           WHERE provider_id = $2
             AND source_listing_id = $3
         )`,
      [userId, publicListing.providerId, publicListing.sourceListingId],
    );

    return result.rowCount === 1;
  }

  async listRecentSearches(userId: string) {
    const result = await this.queryable.query<SearchRow>(
      `${recentSearchSelect}
       WHERE user_id = $1
       ORDER BY submitted_at DESC, id DESC`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows.map(mapSearch) as RecentSearch[];
  }

  async upsertRecentSearch(input: PersistSearchHistoryInput, limit = 8) {
    const search = normalizeSearch(input);
    const queryHash = sha256("search-params-v1", search.params);
    const now = new Date();
    await this.queryable.query(
      `INSERT INTO recent_searches (
         id,
         user_id,
         query_hash,
         query,
         submitted_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (user_id, query_hash) DO UPDATE SET
         query = EXCLUDED.query,
         submitted_at = EXCLUDED.submitted_at`,
      [randomUUID(), assertUuid(input.userId, "User ID"), queryHash, JSON.stringify(search), now],
    );
    await this.queryable.query(
      `DELETE FROM recent_searches
       WHERE user_id = $1
         AND id NOT IN (
           SELECT id
           FROM recent_searches
           WHERE user_id = $1
           ORDER BY submitted_at DESC, id DESC
           LIMIT $2
         )`,
      [input.userId, Math.min(Math.max(Math.trunc(limit), 1), 100)],
    );
    const result = await this.queryable.query<SearchRow>(
      `${recentSearchSelect}
       WHERE user_id = $1
         AND query_hash = $2`,
      [input.userId, queryHash],
    );

    return mapSearch(result.rows[0]) as RecentSearch;
  }

  async clearRecentSearches(userId: string) {
    const result = await this.queryable.query("DELETE FROM recent_searches WHERE user_id = $1", [
      assertUuid(userId, "User ID"),
    ]);
    return result.rowCount;
  }

  async listSavedSearches(userId: string) {
    const result = await this.queryable.query<SearchRow>(
      `${savedSearchSelect}
       WHERE user_id = $1
       ORDER BY updated_at DESC, created_at DESC, id DESC`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows.map(mapSearch) as SavedSearch[];
  }

  async upsertSavedSearch(input: PersistSearchHistoryInput) {
    const search = normalizeSearch(input);
    const queryHash = sha256("search-params-v1", search.params);
    const now = new Date();
    await this.queryable.query(
      `INSERT INTO saved_searches (
         id,
         user_id,
         label,
         query_hash,
         query,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
       ON CONFLICT (user_id, query_hash) DO UPDATE SET
         label = EXCLUDED.label,
         query = EXCLUDED.query,
         updated_at = EXCLUDED.updated_at`,
      [
        randomUUID(),
        assertUuid(input.userId, "User ID"),
        search.label,
        queryHash,
        JSON.stringify(search),
        now,
      ],
    );
    const result = await this.queryable.query<SearchRow>(
      `${savedSearchSelect}
       WHERE user_id = $1
         AND query_hash = $2`,
      [input.userId, queryHash],
    );

    return mapSearch(result.rows[0]) as SavedSearch;
  }

  async deleteSavedSearch(input: { id?: string; params?: string; userId: string }) {
    const userId = assertUuid(input.userId, "User ID");

    if (input.id) {
      const result = await this.queryable.query(
        `DELETE FROM saved_searches
         WHERE user_id = $1
           AND id = $2`,
        [userId, assertUuid(input.id, "Saved search ID")],
      );
      return result.rowCount === 1;
    }

    if (!input.params) {
      throw new RequestStoreError(
        "invalid_saved_feature",
        "Saved search ID or parameters are required.",
      );
    }

    const result = await this.queryable.query(
      `DELETE FROM saved_searches
       WHERE user_id = $1
         AND query_hash = $2`,
      [userId, sha256("search-params-v1", normalizeSearchParams(input.params))],
    );
    return result.rowCount === 1;
  }

  async listSavedFilters(userId: string) {
    const result = await this.queryable.query<SavedFilterRow>(
      `${savedFilterSelect}
       WHERE user_id = $1
       ORDER BY updated_at DESC, created_at DESC, id DESC`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows.map(mapSavedFilter);
  }

  async upsertSavedFilter(input: PersistSavedFilterInput) {
    const normalized = normalizeSavedFilter(input);
    const now = new Date();
    await this.queryable.query(
      `INSERT INTO saved_filters (
         id,
         user_id,
         label,
         filter_hash,
         filters,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
       ON CONFLICT (user_id, filter_hash) DO UPDATE SET
         label = EXCLUDED.label,
         filters = EXCLUDED.filters,
         updated_at = EXCLUDED.updated_at`,
      [
        randomUUID(),
        assertUuid(input.userId, "User ID"),
        normalized.label,
        normalized.filterHash,
        JSON.stringify(normalized.filters),
        now,
      ],
    );
    const result = await this.queryable.query<SavedFilterRow>(
      `${savedFilterSelect}
       WHERE user_id = $1
         AND filter_hash = $2`,
      [input.userId, normalized.filterHash],
    );

    return mapSavedFilter(result.rows[0]);
  }

  async deleteSavedFilter(userId: string, id: string) {
    const result = await this.queryable.query(
      `DELETE FROM saved_filters
       WHERE user_id = $1
         AND id = $2`,
      [assertUuid(userId, "User ID"), assertUuid(id, "Saved filter ID")],
    );
    return result.rowCount === 1;
  }

  async listWatchlists(userId: string) {
    const result = await this.queryable.query<WatchlistRow>(
      `${watchlistSelect}
       WHERE user_id = $1
       ORDER BY updated_at DESC, created_at DESC, id DESC`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows.map(mapWatchlist);
  }

  async findWatchlist(userId: string, id: string) {
    const result = await this.queryable.query<WatchlistRow>(
      `${watchlistSelect}
       WHERE user_id = $1
         AND id = $2`,
      [assertUuid(userId, "User ID"), assertUuid(id, "Watchlist ID")],
    );

    return result.rows[0] ? mapWatchlist(result.rows[0]) : undefined;
  }

  private async resolveCanonicalBrandId(brand: string | undefined) {
    if (!brand) {
      return undefined;
    }

    const result = await this.queryable.query<{ id: string }>(
      `SELECT b.id
       FROM brands b
       LEFT JOIN brand_aliases ba ON ba.brand_id = b.id
       WHERE lower(b.canonical_name) = lower($1)
          OR ba.normalized_alias = lower($1)
       ORDER BY b.id
       LIMIT 1`,
      [brand],
    );

    return result.rows[0]?.id;
  }

  async createWatchlist(input: PersistWatchlistInput) {
    const normalized = this.normalizeWatchlist(input);
    const canonicalBrandId = await this.resolveCanonicalBrandId(normalized.brand);
    const now = new Date();
    const result = await this.queryable.query<WatchlistRow>(
      `INSERT INTO watchlists (
         id,
         user_id,
         label,
         query_text,
         canonical_brand_id,
         brand_text,
         category,
         source_marketplace,
         listing_type,
         min_price_minor,
         max_price_minor,
         price_currency,
         size,
         condition,
         enabled,
         created_at,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15, $16, $16
       )
       RETURNING
         id,
         user_id,
         label,
         query_text,
         brand_text,
         category,
         source_marketplace,
         listing_type,
         min_price_minor,
         max_price_minor,
         price_currency,
         condition,
         size,
         enabled,
         created_at,
         updated_at`,
      [
        randomUUID(),
        assertUuid(input.userId, "User ID"),
        normalized.label,
        normalized.queryText ?? null,
        canonicalBrandId ?? null,
        normalized.brand ?? null,
        normalized.category ?? null,
        normalized.source ?? null,
        normalized.listingType ?? null,
        normalized.minPriceMinor ?? null,
        normalized.maxPriceMinor ?? null,
        normalized.priceCurrency ?? null,
        normalized.size ?? null,
        normalized.condition ?? null,
        normalized.enabled,
        now,
      ],
    );

    return mapWatchlist(result.rows[0]);
  }

  async updateWatchlist(input: UpdateWatchlistInput) {
    const existing = await this.findWatchlist(input.userId, input.id);

    if (!existing) {
      return undefined;
    }

    const merged: PersistWatchlistInput = {
      brand: input.brand === undefined ? existing.brand : input.brand,
      category: input.category === undefined ? existing.category : input.category,
      condition: input.condition === undefined ? existing.condition : input.condition,
      enabled: input.enabled === undefined ? existing.enabled : input.enabled,
      label: input.label === undefined ? existing.label : input.label,
      listingType: input.listingType === undefined ? existing.listingType : input.listingType,
      maxPriceAmount:
        input.maxPriceAmount === undefined ? existing.maxPriceAmount : input.maxPriceAmount,
      minPriceAmount:
        input.minPriceAmount === undefined ? existing.minPriceAmount : input.minPriceAmount,
      priceCurrency:
        input.priceCurrency === undefined ? existing.priceCurrency : input.priceCurrency,
      queryText: input.queryText === undefined ? existing.queryText : input.queryText,
      size: input.size === undefined ? existing.size : input.size,
      source: input.source === undefined ? existing.source : input.source,
      userId: input.userId,
    };
    const normalized = this.normalizeWatchlist(merged);
    const canonicalBrandId = await this.resolveCanonicalBrandId(normalized.brand);
    const result = await this.queryable.query<WatchlistRow>(
      `UPDATE watchlists
       SET label = $3,
           query_text = $4,
           canonical_brand_id = $5,
           brand_text = $6,
           category = $7,
           source_marketplace = $8,
           listing_type = $9,
           min_price_minor = $10,
           max_price_minor = $11,
           price_currency = $12,
           size = $13,
           condition = $14,
           enabled = $15,
           updated_at = $16
       WHERE user_id = $1
         AND id = $2
       RETURNING
         id,
         user_id,
         label,
         query_text,
         brand_text,
         category,
         source_marketplace,
         listing_type,
         min_price_minor,
         max_price_minor,
         price_currency,
         condition,
         size,
         enabled,
         created_at,
         updated_at`,
      [
        assertUuid(input.userId, "User ID"),
        assertUuid(input.id, "Watchlist ID"),
        normalized.label,
        normalized.queryText ?? null,
        canonicalBrandId ?? null,
        normalized.brand ?? null,
        normalized.category ?? null,
        normalized.source ?? null,
        normalized.listingType ?? null,
        normalized.minPriceMinor ?? null,
        normalized.maxPriceMinor ?? null,
        normalized.priceCurrency ?? null,
        normalized.size ?? null,
        normalized.condition ?? null,
        normalized.enabled,
        new Date(),
      ],
    );

    return result.rows[0] ? mapWatchlist(result.rows[0]) : undefined;
  }

  async deleteWatchlist(userId: string, id: string) {
    const result = await this.queryable.query(
      `DELETE FROM watchlists
       WHERE user_id = $1
         AND id = $2`,
      [assertUuid(userId, "User ID"), assertUuid(id, "Watchlist ID")],
    );
    return result.rowCount === 1;
  }

  private normalizeWatchlist(input: PersistWatchlistInput) {
    const normalized: PersistWatchlistInput = {
      brand: normalizeBoundedString(input.brand, 200),
      category: normalizeBoundedString(input.category, 160),
      condition: input.condition,
      enabled: input.enabled !== false,
      label: requiredBoundedString(input.label, 160, "invalid_watchlist", "Watchlist label"),
      listingType:
        input.listingType === "auction" || input.listingType === "buy_now"
          ? input.listingType
          : undefined,
      maxPriceAmount: input.maxPriceAmount,
      minPriceAmount: input.minPriceAmount,
      priceCurrency: input.priceCurrency,
      queryText: normalizeBoundedString(input.queryText, 500),
      size: normalizeBoundedString(input.size, 120),
      source: normalizeBoundedString(input.source, 120),
      userId: input.userId,
    };

    if (!meaningfulWatchlist(normalized)) {
      throw new RequestStoreError(
        "invalid_watchlist",
        "Watchlist requires at least one criterion.",
      );
    }

    const hasPrice =
      normalized.minPriceAmount !== undefined || normalized.maxPriceAmount !== undefined;
    const priceCurrency = hasPrice ? normalizeCurrency(normalized.priceCurrency) : undefined;
    const minPriceMinor = priceCurrency
      ? toMinorUnits(normalized.minPriceAmount, priceCurrency, "Minimum price")
      : undefined;
    const maxPriceMinor = priceCurrency
      ? toMinorUnits(normalized.maxPriceAmount, priceCurrency, "Maximum price")
      : undefined;

    if (
      minPriceMinor !== undefined &&
      maxPriceMinor !== undefined &&
      maxPriceMinor < minPriceMinor
    ) {
      throw new RequestStoreError(
        "invalid_watchlist",
        "Watchlist maximum price cannot be below minimum price.",
      );
    }

    return {
      ...normalized,
      maxPriceMinor,
      minPriceMinor,
      priceCurrency,
    };
  }

  async getNotificationPreferences(userId: string) {
    const normalizedUserId = assertUuid(userId, "User ID");
    const result = await this.queryable.query<NotificationRow>(
      `${notificationSelect}
       WHERE user_id = $1`,
      [normalizedUserId],
    );

    if (result.rows[0]) {
      return mapNotification(result.rows[0]);
    }

    const user = await this.queryable.query<{
      created_at: Date | string;
    }>(
      `SELECT created_at
       FROM users
       WHERE id = $1
         AND deleted_at IS NULL`,
      [normalizedUserId],
    );

    if (!user.rows[0]) {
      return undefined;
    }

    const createdAt = toIso(user.rows[0].created_at);
    return {
      createdAt,
      emailEnabled: false,
      frequency: "daily" as const,
      inAppEnabled: true,
      pushEnabled: false,
      smsEnabled: false,
      updatedAt: createdAt,
      userId: normalizedUserId,
    };
  }

  async updateNotificationPreferences(input: UpdateNotificationPreferencesInput) {
    const current = await this.getNotificationPreferences(input.userId);

    if (!current) {
      return undefined;
    }

    const frequency = input.frequency ?? current.frequency;

    if (frequency !== "instant" && frequency !== "daily" && frequency !== "weekly") {
      throw new RequestStoreError(
        "invalid_notification_preferences",
        "Notification frequency is unsupported.",
      );
    }

    const quietHours = validateQuietHours(
      input.quietHoursStart === undefined ? current.quietHoursStart : input.quietHoursStart,
      input.quietHoursEnd === undefined ? current.quietHoursEnd : input.quietHoursEnd,
    );
    const result = await this.queryable.query<NotificationRow>(
      `INSERT INTO notification_preferences (
         user_id,
         email_enabled,
         push_enabled,
         sms_enabled,
         in_app_enabled,
         frequency,
         quiet_hours_start,
         quiet_hours_end,
         timezone,
         created_at,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::time, $8::time, 'UTC', $9, $10
       )
       ON CONFLICT (user_id) DO UPDATE SET
         email_enabled = EXCLUDED.email_enabled,
         push_enabled = EXCLUDED.push_enabled,
         sms_enabled = EXCLUDED.sms_enabled,
         in_app_enabled = EXCLUDED.in_app_enabled,
         frequency = EXCLUDED.frequency,
         quiet_hours_start = EXCLUDED.quiet_hours_start,
         quiet_hours_end = EXCLUDED.quiet_hours_end,
         updated_at = EXCLUDED.updated_at
       RETURNING
         user_id,
         email_enabled,
         push_enabled,
         sms_enabled,
         in_app_enabled,
         frequency,
         quiet_hours_start,
         quiet_hours_end,
         created_at,
         updated_at`,
      [
        assertUuid(input.userId, "User ID"),
        input.emailEnabled ?? current.emailEnabled,
        input.pushEnabled ?? current.pushEnabled,
        input.smsEnabled ?? current.smsEnabled,
        input.inAppEnabled ?? current.inAppEnabled,
        frequency,
        quietHours.start ?? null,
        quietHours.end ?? null,
        new Date(current.createdAt),
        new Date(),
      ],
    );

    return mapNotification(result.rows[0]);
  }

  async listAlertMatchesForExport(userId: string) {
    const result = await this.queryable.query<{
      dismissed_at: Date | string | null;
      first_matched_at: Date | string;
      id: string;
      last_matched_at: Date | string;
      match_reasons: unknown;
      provider_id: string;
      source_listing_id: string;
      state: string;
      watchlist_id: string;
    }>(
      `SELECT
         am.id,
         am.watchlist_id,
         am.state,
         am.match_reasons,
         am.first_matched_at,
         am.last_matched_at,
         am.dismissed_at,
         l.provider_id,
         l.source_listing_id
       FROM alert_matches am
       JOIN listings l ON l.id = am.listing_id
       WHERE am.user_id = $1
       ORDER BY am.first_matched_at, am.id`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows.map((row) => ({
      dismissedAt: row.dismissed_at ? toIso(row.dismissed_at) : undefined,
      firstMatchedAt: toIso(row.first_matched_at),
      id: row.id,
      lastMatchedAt: toIso(row.last_matched_at),
      listingId: formatPublicListingId(row.provider_id, row.source_listing_id),
      reasons: parseJsonArray(row.match_reasons),
      state: row.state,
      watchlistId: row.watchlist_id,
    }));
  }
}
