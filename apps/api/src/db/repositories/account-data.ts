import { getDatabase } from "../database.js";

interface AccountRow {
  createdAt: string;
  currencyPreference: string;
  id: string;
  onboardingPreferencesJson: string;
  username: string;
}

interface SettingsRow {
  createdAt: string;
  defaultSortMode: string | null;
  displayName: string | null;
  preferredSourcesJson: string;
  updatedAt: string;
}

interface LikeExportRow {
  createdAt: string;
  id: string;
  listingId: string;
  listingSnapshotJson: string | null;
  source: string;
}

interface AlertMatchExportRow {
  dismissedAt: string | null;
  firstMatchedAt: string;
  id: string;
  lastMatchedAt: string;
  listingId: string;
  matchedReasonJson: string;
  source: string;
  sourceListingId: string;
  status: string;
  watchlistId: string;
}

function parseJson(value: string | null, fallback: unknown) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function listRows<T extends object>(sql: string, userId: string) {
  return getDatabase().prepare(sql).all(userId) as unknown as T[];
}

export interface AccountDataExport {
  account: {
    createdAt: string;
    currencyPreference: string;
    id: string;
    onboardingPreferences: unknown;
    username: string;
  };
  alertMatches: Array<Record<string, unknown>>;
  emailIdentities: Array<Record<string, unknown>>;
  exportedAt: string;
  likes: Array<Record<string, unknown>>;
  notificationPreferences: Array<Record<string, unknown>>;
  recentSearches: Array<Record<string, unknown>>;
  savedFilters: Array<Record<string, unknown>>;
  savedSearches: Array<Record<string, unknown>>;
  schemaVersion: 1;
  securityNotice: string;
  sessions: Array<Record<string, unknown>>;
  settings: Array<Record<string, unknown>>;
  watchlists: Array<Record<string, unknown>>;
}

export function getAccountDataExport(
  userId: string,
  exportedAt: string,
): AccountDataExport | undefined {
  const database = getDatabase();
  const account = database
    .prepare(
      `SELECT
        id,
        username,
        currency_preference AS currencyPreference,
        onboarding_preferences_json AS onboardingPreferencesJson,
        created_at AS createdAt
      FROM users
      WHERE id = ?`,
    )
    .get(userId) as AccountRow | undefined;

  if (!account) {
    return undefined;
  }

  const identities = listRows<Record<string, unknown>>(
    `SELECT
      id,
      email,
      verified_at AS verifiedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM user_email_identities
    WHERE user_id = ?
    ORDER BY created_at, id`,
    userId,
  );
  const likes = listRows<LikeExportRow>(
    `SELECT
      id,
      listing_id AS listingId,
      source,
      created_at AS createdAt,
      listing_snapshot_json AS listingSnapshotJson
    FROM likes
    WHERE user_id = ?
    ORDER BY created_at, id`,
    userId,
  ).map(({ listingSnapshotJson, ...like }) => ({
    ...like,
    listingSnapshot: parseJson(listingSnapshotJson, null),
  }));
  const recentSearches = listRows<Record<string, unknown>>(
    `SELECT
      id,
      label,
      description,
      params,
      created_at AS createdAt
    FROM recent_searches
    WHERE user_id = ?
    ORDER BY created_at, id`,
    userId,
  );
  const savedSearches = listRows<Record<string, unknown>>(
    `SELECT
      id,
      label,
      description,
      params,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM saved_searches
    WHERE user_id = ?
    ORDER BY created_at, id`,
    userId,
  );
  const savedFilters = listRows<Record<string, unknown>>(
    `SELECT
      id,
      label,
      query_text AS queryText,
      source_filter AS source,
      listing_type_filter AS listingType,
      min_price AS minPrice,
      max_price AS maxPrice,
      sort_mode AS sortMode,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM saved_filters
    WHERE user_id = ?
    ORDER BY created_at, id`,
    userId,
  );
  const watchlists = listRows<Record<string, unknown>>(
    `SELECT
      id,
      label,
      query_text AS queryText,
      brand,
      category,
      source_filter AS source,
      listing_type AS listingType,
      min_price_amount AS minPriceAmount,
      max_price_amount AS maxPriceAmount,
      price_currency AS priceCurrency,
      condition,
      size,
      enabled,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM watchlists
    WHERE user_id = ?
    ORDER BY created_at, id`,
    userId,
  ).map((row) => ({
    ...row,
    enabled: row.enabled !== 0,
  }));
  const settings = listRows<SettingsRow>(
    `SELECT
      display_name AS displayName,
      default_sort_mode AS defaultSortMode,
      preferred_sources_json AS preferredSourcesJson,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM user_settings
    WHERE user_id = ?`,
    userId,
  ).map(({ preferredSourcesJson, ...setting }) => ({
    ...setting,
    preferredSources: parseJson(preferredSourcesJson, []),
  }));
  const notificationPreferences = listRows<Record<string, unknown>>(
    `SELECT
      email_enabled AS emailEnabled,
      push_enabled AS pushEnabled,
      sms_enabled AS smsEnabled,
      in_app_enabled AS inAppEnabled,
      frequency,
      quiet_hours_start AS quietHoursStart,
      quiet_hours_end AS quietHoursEnd,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM notification_preferences
    WHERE user_id = ?`,
    userId,
  ).map((row) => ({
    ...row,
    emailEnabled: row.emailEnabled !== 0,
    inAppEnabled: row.inAppEnabled !== 0,
    pushEnabled: row.pushEnabled !== 0,
    smsEnabled: row.smsEnabled !== 0,
  }));
  const alertMatches = listRows<AlertMatchExportRow>(
    `SELECT
      id,
      watchlist_id AS watchlistId,
      listing_id AS listingId,
      source,
      source_listing_id AS sourceListingId,
      matched_reason_json AS matchedReasonJson,
      status,
      first_matched_at AS firstMatchedAt,
      last_matched_at AS lastMatchedAt,
      dismissed_at AS dismissedAt
    FROM alert_matches
    WHERE user_id = ?
    ORDER BY first_matched_at, id`,
    userId,
  ).map(({ matchedReasonJson, ...match }) => ({
    ...match,
    matchedReasons: parseJson(matchedReasonJson, []),
  }));
  const sessions = listRows<Record<string, unknown>>(
    `SELECT
      id,
      created_at AS createdAt,
      expires_at AS expiresAt,
      last_seen_at AS lastSeenAt,
      revoked_at AS revokedAt,
      user_agent AS userAgent,
      ip_hint AS ipHint
    FROM auth_sessions
    WHERE user_id = ?
    ORDER BY created_at, id`,
    userId,
  );

  return {
    account: {
      createdAt: account.createdAt,
      currencyPreference: account.currencyPreference,
      id: account.id,
      onboardingPreferences: parseJson(account.onboardingPreferencesJson, {}),
      username: account.username,
    },
    alertMatches,
    emailIdentities: identities,
    exportedAt,
    likes,
    notificationPreferences,
    recentSearches,
    savedFilters,
    savedSearches,
    schemaVersion: 1,
    securityNotice:
      "Password hashes, session-token hashes, and one-time account tokens are excluded.",
    sessions,
    settings,
    watchlists,
  };
}
