import type {
  NotificationPreferences,
  UpdateNotificationPreferencesInput,
} from "@closetsearch/shared";
import { ApiError } from "../api-error.js";
import {
  getNotificationPreferencesByUserId,
  upsertNotificationPreferences,
} from "../db/repositories/notification-preferences.js";
import { getUserById } from "../user-service.js";

const supportedFrequencies = new Set(["instant", "daily", "weekly"]);
const quietHoursPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function buildDefaultNotificationPreferences(userId: string): NotificationPreferences {
  const user = getUserById(userId);

  if (!user) {
    throw new ApiError(404, "user_not_found", "User not found.");
  }

  return {
    userId,
    emailEnabled: false,
    pushEnabled: false,
    smsEnabled: false,
    inAppEnabled: true,
    frequency: "daily",
    createdAt: user.createdAt,
    updatedAt: user.createdAt,
  };
}

function validateQuietHours(value: string | null | undefined, label: string) {
  if (value === null || value === undefined || value.trim().length === 0) {
    return;
  }

  if (!quietHoursPattern.test(value.trim())) {
    throw new ApiError(400, "invalid_request", `${label} must use HH:MM 24-hour time.`);
  }
}

export function getAlertPreferencesByUserId(userId: string) {
  return getNotificationPreferencesByUserId(userId) ?? buildDefaultNotificationPreferences(userId);
}

export function updateAlertPreferences(input: UpdateNotificationPreferencesInput) {
  const currentPreferences = getAlertPreferencesByUserId(input.userId);

  if (input.frequency && !supportedFrequencies.has(input.frequency)) {
    throw new ApiError(400, "invalid_request", "frequency is not supported.");
  }

  validateQuietHours(input.quietHoursStart, "quietHoursStart");
  validateQuietHours(input.quietHoursEnd, "quietHoursEnd");

  return upsertNotificationPreferences({
    userId: input.userId,
    emailEnabled: input.emailEnabled ?? currentPreferences.emailEnabled,
    pushEnabled: input.pushEnabled ?? currentPreferences.pushEnabled,
    smsEnabled: input.smsEnabled ?? currentPreferences.smsEnabled,
    inAppEnabled: input.inAppEnabled ?? currentPreferences.inAppEnabled,
    frequency: input.frequency ?? currentPreferences.frequency,
    quietHoursStart:
      input.quietHoursStart !== undefined
        ? input.quietHoursStart
        : currentPreferences.quietHoursStart ?? null,
    quietHoursEnd:
      input.quietHoursEnd !== undefined
        ? input.quietHoursEnd
        : currentPreferences.quietHoursEnd ?? null,
  });
}
