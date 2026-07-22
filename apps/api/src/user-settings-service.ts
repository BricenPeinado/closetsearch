import type { UpdateUserSettingsInput } from "@closetsearch/shared";
import { ApiError } from "./api-error.js";
import {
  clearUserSettings,
  getUserSettingsByUserId,
  upsertUserSettings,
} from "./db/repositories/user-settings.js";

const supportedSortModes = new Set(["relevance", "price_asc", "price_desc", "newest"]);

function normalizeCurrency(value: string | undefined) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizePreferredSources(value: string[] | undefined) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((entry) => entry.trim()).filter(Boolean);
}

function normalizeDisplayName(value: string | null | undefined) {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value.trim() || null : undefined;
}

export function getSettingsByUserId(userId: string) {
  const settings = getUserSettingsByUserId(userId);

  if (!settings) {
    throw new ApiError(404, "user_not_found", "User not found.");
  }

  return settings;
}

export function updateSettings(input: UpdateUserSettingsInput) {
  const preferredCurrency = normalizeCurrency(input.preferredCurrency);

  if (preferredCurrency && preferredCurrency.length !== 3) {
    throw new ApiError(400, "invalid_request", "preferredCurrency must be a 3-letter currency code.");
  }

  if (
    input.defaultSortMode !== undefined &&
    input.defaultSortMode !== null &&
    !supportedSortModes.has(input.defaultSortMode)
  ) {
    throw new ApiError(400, "invalid_request", "defaultSortMode is not supported.");
  }

  const settings = upsertUserSettings({
    userId: input.userId,
    preferredCurrency: preferredCurrency || undefined,
    defaultSortMode: input.defaultSortMode,
    preferredSources: normalizePreferredSources(input.preferredSources),
    displayName: normalizeDisplayName(input.displayName),
  });

  if (!settings) {
    throw new ApiError(404, "user_not_found", "User not found.");
  }

  return settings;
}

export function resetUserSettingsStore() {
  clearUserSettings();
}
