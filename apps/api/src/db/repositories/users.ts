import type { OnboardingPreferences, StoredUser } from "@closetsearch/shared";
import { getDatabase } from "../database.js";

interface UserRow {
  id: string;
  username: string;
  normalized_username: string;
  password_hash: string;
  currency_preference: string;
  onboarding_preferences_json: string;
  created_at: string;
}

function parsePreferences(value: string): OnboardingPreferences {
  const parsedValue = JSON.parse(value) as Partial<OnboardingPreferences>;

  return {
    favoriteBrands: Array.isArray(parsedValue.favoriteBrands)
      ? parsedValue.favoriteBrands.filter((item): item is string => typeof item === "string")
      : [],
    categories: Array.isArray(parsedValue.categories)
      ? parsedValue.categories.filter((item): item is string => typeof item === "string")
      : [],
    priceRange:
      typeof parsedValue.priceRange === "string" ? parsedValue.priceRange : "",
  };
}

function mapUserRow(row: UserRow): StoredUser {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    onboardingPreferences: parsePreferences(row.onboarding_preferences_json),
    currencyPreference: row.currency_preference,
    createdAt: row.created_at,
  };
}

export function insertUser(user: {
  id: string;
  username: string;
  normalizedUsername: string;
  passwordHash: string;
  onboardingPreferences: OnboardingPreferences;
  currencyPreference: string;
  createdAt: string;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO users (
        id,
        username,
        normalized_username,
        password_hash,
        currency_preference,
        onboarding_preferences_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.id,
      user.username,
      user.normalizedUsername,
      user.passwordHash,
      user.currencyPreference,
      JSON.stringify(user.onboardingPreferences),
      user.createdAt,
    );
}

export function findUserById(userId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT
        id,
        username,
        normalized_username,
        password_hash,
        currency_preference,
        onboarding_preferences_json,
        created_at
      FROM users
      WHERE id = ?`,
    )
    .get(userId) as UserRow | undefined;

  return row ? mapUserRow(row) : undefined;
}

export function findUserByNormalizedUsername(normalizedUsername: string) {
  const row = getDatabase()
    .prepare(
      `SELECT
        id,
        username,
        normalized_username,
        password_hash,
        currency_preference,
        onboarding_preferences_json,
        created_at
      FROM users
      WHERE normalized_username = ?`,
    )
    .get(normalizedUsername) as UserRow | undefined;

  return row ? mapUserRow(row) : undefined;
}

export function updateUserPreferences(
  userId: string,
  preferences: OnboardingPreferences,
  currencyPreference: string,
) {
  getDatabase()
    .prepare(
      `UPDATE users
      SET onboarding_preferences_json = ?, currency_preference = ?
      WHERE id = ?`,
    )
    .run(JSON.stringify(preferences), currencyPreference, userId);

  return findUserById(userId);
}

export function clearUsers() {
  getDatabase().prepare("DELETE FROM users").run();
}
