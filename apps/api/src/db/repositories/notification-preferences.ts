import type {
  NotificationPreferences,
  UpdateNotificationPreferencesInput,
} from "@closetsearch/shared";
import { getDatabase } from "../database.js";

interface NotificationPreferencesRow {
  user_id: string;
  email_enabled: number;
  push_enabled: number;
  sms_enabled: number;
  in_app_enabled: number;
  frequency: string;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  created_at: string;
  updated_at: string;
}

function toTrimmedString(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function mapNotificationPreferencesRow(row: NotificationPreferencesRow): NotificationPreferences {
  return {
    userId: row.user_id,
    emailEnabled: row.email_enabled !== 0,
    pushEnabled: row.push_enabled !== 0,
    smsEnabled: row.sms_enabled !== 0,
    inAppEnabled: row.in_app_enabled !== 0,
    frequency:
      row.frequency === "instant" || row.frequency === "weekly" ? row.frequency : "daily",
    quietHoursStart: toTrimmedString(row.quiet_hours_start) || undefined,
    quietHoursEnd: toTrimmedString(row.quiet_hours_end) || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getNotificationPreferencesByUserId(userId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT
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
      WHERE user_id = ?`,
    )
    .get(userId) as NotificationPreferencesRow | undefined;

  return row ? mapNotificationPreferencesRow(row) : undefined;
}

export function upsertNotificationPreferences(input: UpdateNotificationPreferencesInput) {
  const existing = getNotificationPreferencesByUserId(input.userId);
  const now = new Date().toISOString();
  const createdAt = existing?.createdAt ?? now;

  getDatabase()
    .prepare(
      `INSERT INTO notification_preferences (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        email_enabled = excluded.email_enabled,
        push_enabled = excluded.push_enabled,
        sms_enabled = excluded.sms_enabled,
        in_app_enabled = excluded.in_app_enabled,
        frequency = excluded.frequency,
        quiet_hours_start = excluded.quiet_hours_start,
        quiet_hours_end = excluded.quiet_hours_end,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.userId,
      input.emailEnabled ? 1 : 0,
      input.pushEnabled ? 1 : 0,
      input.smsEnabled ? 1 : 0,
      input.inAppEnabled === false ? 0 : 1,
      input.frequency ?? "daily",
      toTrimmedString(input.quietHoursStart ?? undefined) || null,
      toTrimmedString(input.quietHoursEnd ?? undefined) || null,
      createdAt,
      now,
    );

  return getNotificationPreferencesByUserId(input.userId) as NotificationPreferences;
}

export function clearNotificationPreferences() {
  getDatabase().prepare("DELETE FROM notification_preferences").run();
}
