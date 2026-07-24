import type { UpdateUserSettingsInput, UserSettings } from "@closetsearch/shared";
import { getDatabase } from "../database.js";

interface UserSettingsRow {
  user_id: string;
  currency_preference: string;
  display_name?: string | null;
  default_sort_mode?: UserSettings["defaultSortMode"] | null;
  preferred_sources_json?: string | null;
  settings_created_at?: string | null;
  settings_updated_at?: string | null;
  user_created_at: string;
}

function toTrimmedString(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePreferredSources(value: string | null | undefined) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsedValue = JSON.parse(value) as unknown;

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function mapUserSettingsRow(row: UserSettingsRow): UserSettings {
  return {
    userId: row.user_id,
    preferredCurrency: row.currency_preference,
    defaultSortMode: row.default_sort_mode ?? undefined,
    preferredSources: parsePreferredSources(row.preferred_sources_json),
    displayName: toTrimmedString(row.display_name) || undefined,
    createdAt: row.settings_created_at ?? row.user_created_at,
    updatedAt: row.settings_updated_at ?? row.user_created_at,
  };
}

export function getUserSettingsByUserId(userId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT
        users.id AS user_id,
        users.currency_preference,
        users.created_at AS user_created_at,
        user_settings.display_name,
        user_settings.default_sort_mode,
        user_settings.preferred_sources_json,
        user_settings.created_at AS settings_created_at,
        user_settings.updated_at AS settings_updated_at
      FROM users
      LEFT JOIN user_settings ON user_settings.user_id = users.id
      WHERE users.id = ?`,
    )
    .get(userId) as UserSettingsRow | undefined;

  return row ? mapUserSettingsRow(row) : undefined;
}

export function upsertUserSettings(input: UpdateUserSettingsInput) {
  const existingSettings = getUserSettingsByUserId(input.userId);

  if (!existingSettings) {
    return undefined;
  }

  const now = new Date().toISOString();
  const preferredCurrency =
    typeof input.preferredCurrency === "string" && input.preferredCurrency.trim().length > 0
      ? input.preferredCurrency.trim().toUpperCase()
      : existingSettings.preferredCurrency;
  const displayName =
    input.displayName === null
      ? null
      : typeof input.displayName === "string"
        ? input.displayName.trim() || null
        : (existingSettings.displayName ?? null);
  const defaultSortMode =
    input.defaultSortMode === null
      ? null
      : (input.defaultSortMode ?? existingSettings.defaultSortMode ?? null);
  const preferredSources =
    input.preferredSources !== undefined
      ? input.preferredSources.map((entry) => entry.trim()).filter(Boolean)
      : existingSettings.preferredSources;

  getDatabase()
    .prepare(
      `UPDATE users
      SET currency_preference = ?
      WHERE id = ?`,
    )
    .run(preferredCurrency, input.userId);

  getDatabase()
    .prepare(
      `INSERT INTO user_settings (
        user_id,
        display_name,
        default_sort_mode,
        preferred_sources_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        default_sort_mode = excluded.default_sort_mode,
        preferred_sources_json = excluded.preferred_sources_json,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.userId,
      displayName,
      defaultSortMode,
      JSON.stringify(preferredSources),
      existingSettings.createdAt,
      now,
    );

  return getUserSettingsByUserId(input.userId);
}

export function clearUserSettings() {
  getDatabase().prepare("DELETE FROM user_settings").run();
}
