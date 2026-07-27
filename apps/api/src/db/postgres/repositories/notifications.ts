import { createHmac, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { PostgresDatabase } from "../database.js";

export type NotificationChannel = "email" | "sms";
export type AlertEventType =
  "auction_ending" | "back_in_range" | "digest" | "new_listing" | "price_drop" | "security";

interface PhoneIdentityRow extends QueryResultRow {
  created_at: Date | string;
  disabled_at: Date | string | null;
  id: string;
  phone_e164: string;
  updated_at: Date | string;
  user_id: string;
  verified_at: Date | string | null;
}

interface ChallengeRow extends QueryResultRow {
  attempt_count: number;
  code_hash: string;
  created_at: Date | string;
  expires_at: Date | string;
  id: string;
  phone_identity_id: string;
}

interface WatchlistAlertSettingsRow extends QueryResultRow {
  alert_email_enabled: boolean;
  alert_event_types: unknown;
  alert_in_app_enabled: boolean;
  alert_sms_enabled: boolean;
  id: string;
}

interface NotificationSettingsRow extends QueryResultRow {
  created_at: Date | string;
  email_enabled: boolean;
  frequency: "daily" | "hourly" | "instant" | "weekly";
  in_app_enabled: boolean;
  push_enabled: boolean;
  quiet_hours_end: string | null;
  quiet_hours_start: string | null;
  sms_enabled: boolean;
  timezone: string;
  updated_at: Date | string;
  user_id: string;
}

interface UnsubscribeTokenRow extends QueryResultRow {
  consumed_at: Date | string | null;
  destination_hash: string;
  expires_at: Date | string;
  id: string;
  user_id: string;
}

const allowedAlertEvents = new Set<AlertEventType>([
  "auction_ending",
  "back_in_range",
  "new_listing",
  "price_drop",
]);

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function hashNotificationDestination(value: string) {
  const configuredPepper =
    process.env.NOTIFICATION_DESTINATION_PEPPER?.trim() || process.env.AUTH_SESSION_PEPPER?.trim();
  const pepper =
    configuredPepper ||
    (process.env.NODE_ENV === "production" ? "" : "closetsearch-local-destination-pepper-v1");

  if (pepper.length < 32) {
    throw new Error("NOTIFICATION_DESTINATION_PEPPER must contain at least 32 characters.");
  }

  return createHmac("sha256", pepper)
    .update("closetsearch-notification-destination-v1")
    .update("\0")
    .update(value.trim().toLowerCase(), "utf8")
    .digest("hex");
}

export function normalizePhoneE164(value: string) {
  const normalized = value.replace(/[\s().-]/g, "");

  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
    throw new TypeError("Phone number must be in E.164 format, for example +12025550123.");
  }

  return normalized;
}

function parseAlertEvents(value: unknown): AlertEventType[] {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  return Array.isArray(parsed)
    ? parsed.filter(
        (entry): entry is AlertEventType =>
          typeof entry === "string" && allowedAlertEvents.has(entry as AlertEventType),
      )
    : [];
}

function mapPhone(row: PhoneIdentityRow) {
  return {
    createdAt: toIso(row.created_at),
    disabledAt: row.disabled_at ? toIso(row.disabled_at) : undefined,
    id: row.id,
    phoneE164: row.phone_e164,
    updatedAt: toIso(row.updated_at),
    userId: row.user_id,
    verifiedAt: row.verified_at ? toIso(row.verified_at) : undefined,
  };
}

function mapWatchlistSettings(row: WatchlistAlertSettingsRow) {
  return {
    channels: {
      email: row.alert_email_enabled,
      inApp: row.alert_in_app_enabled,
      sms: row.alert_sms_enabled,
    },
    eventTypes: parseAlertEvents(row.alert_event_types),
    watchlistId: row.id,
  };
}

function mapNotificationSettings(row: NotificationSettingsRow) {
  return {
    createdAt: toIso(row.created_at),
    emailEnabled: row.email_enabled,
    frequency: row.frequency,
    inAppEnabled: row.in_app_enabled,
    pushEnabled: row.push_enabled,
    quietHoursEnd: row.quiet_hours_end?.slice(0, 5) || undefined,
    quietHoursStart: row.quiet_hours_start?.slice(0, 5) || undefined,
    smsEnabled: row.sms_enabled,
    timezone: row.timezone,
    updatedAt: toIso(row.updated_at),
    userId: row.user_id,
  };
}

async function persistActiveSuppression(
  queryable: {
    query: PostgresDatabase["query"];
  },
  input: {
    channel: NotificationChannel;
    destinationHash: string;
    metadata?: Record<string, unknown>;
    occurredAt: Date;
    providerEventId?: string;
    reason: "bounce" | "complaint" | "invalid_destination" | "manual" | "sms_stop" | "unsubscribe";
    userId?: string;
  },
) {
  const inserted = await queryable.query(
    `INSERT INTO notification_suppressions (
       id,
       user_id,
       channel,
       destination_hash,
       reason,
       provider_event_id,
       created_at,
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      input.userId ?? null,
      input.channel,
      input.destinationHash,
      input.reason,
      input.providerEventId ?? null,
      input.occurredAt,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  if (inserted.rows.length > 0) {
    return;
  }

  await queryable.query(
    `UPDATE notification_suppressions
     SET user_id = COALESCE(user_id, $3),
         reason = $4,
         provider_event_id = COALESCE($5, provider_event_id),
         created_at = $6,
         metadata = $7::jsonb
     WHERE channel = $1
       AND destination_hash = $2
       AND released_at IS NULL`,
    [
      input.channel,
      input.destinationHash,
      input.userId ?? null,
      input.reason,
      input.providerEventId ?? null,
      input.occurredAt,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export class NotificationRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async getPhoneIdentity(userId: string) {
    const result = await this.database.query<PhoneIdentityRow>(
      `SELECT
         id,
         user_id,
         phone_e164,
         verified_at,
         disabled_at,
         created_at,
         updated_at
       FROM user_phone_identities
       WHERE user_id = $1`,
      [userId],
    );

    return result.rows[0] ? mapPhone(result.rows[0]) : undefined;
  }

  async getSettings(userId: string) {
    const result = await this.database.query<NotificationSettingsRow>(
      `SELECT
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
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows[0]) {
      return mapNotificationSettings(result.rows[0]);
    }

    const user = await this.database.query<{ created_at: Date | string }>(
      `SELECT created_at
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const createdAt = user.rows[0]?.created_at;

    return createdAt
      ? {
          createdAt: toIso(createdAt),
          emailEnabled: false,
          frequency: "daily" as const,
          inAppEnabled: true,
          pushEnabled: false,
          quietHoursEnd: undefined,
          quietHoursStart: undefined,
          smsEnabled: false,
          timezone: "UTC",
          updatedAt: toIso(createdAt),
          userId,
        }
      : undefined;
  }

  async updateSettings(input: {
    emailEnabled?: boolean;
    frequency?: "daily" | "hourly" | "instant" | "weekly";
    inAppEnabled?: boolean;
    pushEnabled?: boolean;
    quietHoursEnd?: string | null;
    quietHoursStart?: string | null;
    smsEnabled?: boolean;
    timezone?: string;
    userId: string;
  }) {
    const current = await this.getSettings(input.userId);

    if (!current) {
      return undefined;
    }

    const quietHoursStart =
      input.quietHoursStart === undefined
        ? current.quietHoursStart
        : (input.quietHoursStart ?? undefined);
    const quietHoursEnd =
      input.quietHoursEnd === undefined
        ? current.quietHoursEnd
        : (input.quietHoursEnd ?? undefined);

    if (Boolean(quietHoursStart) !== Boolean(quietHoursEnd)) {
      throw new TypeError("Quiet-hours start and end must both be provided or both be null.");
    }
    if (
      [quietHoursStart, quietHoursEnd].some(
        (value) => value !== undefined && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value),
      )
    ) {
      throw new TypeError("Quiet hours must use 24-hour HH:MM format.");
    }

    const result = await this.database.query<NotificationSettingsRow>(
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
         $1, $2, $3, $4, $5, $6, $7::time, $8::time, $9, $10, $11
       )
       ON CONFLICT (user_id) DO UPDATE SET
         email_enabled = EXCLUDED.email_enabled,
         push_enabled = EXCLUDED.push_enabled,
         sms_enabled = EXCLUDED.sms_enabled,
         in_app_enabled = EXCLUDED.in_app_enabled,
         frequency = EXCLUDED.frequency,
         quiet_hours_start = EXCLUDED.quiet_hours_start,
         quiet_hours_end = EXCLUDED.quiet_hours_end,
         timezone = EXCLUDED.timezone,
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
         timezone,
         created_at,
         updated_at`,
      [
        input.userId,
        input.emailEnabled ?? current.emailEnabled,
        input.pushEnabled ?? current.pushEnabled,
        input.smsEnabled ?? current.smsEnabled,
        input.inAppEnabled ?? current.inAppEnabled,
        input.frequency ?? current.frequency,
        quietHoursStart ?? null,
        quietHoursEnd ?? null,
        input.timezone ?? current.timezone,
        new Date(current.createdAt),
        new Date(),
      ],
    );
    return mapNotificationSettings(result.rows[0]);
  }

  async upsertPhoneIdentity(userId: string, phoneValue: string, occurredAt: Date) {
    const phone = normalizePhoneE164(phoneValue);

    return this.database.withTransaction(async (client) => {
      const existing = await client.query<PhoneIdentityRow>(
        `SELECT
           id,
           user_id,
           phone_e164,
           verified_at,
           disabled_at,
           created_at,
           updated_at
         FROM user_phone_identities
         WHERE user_id = $1
         FOR UPDATE`,
        [userId],
      );
      const previous = existing.rows[0];
      const result = await client.query<PhoneIdentityRow>(
        `INSERT INTO user_phone_identities (
           id,
           user_id,
           phone_e164,
           normalized_phone_e164,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $3, $4, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           phone_e164 = EXCLUDED.phone_e164,
           normalized_phone_e164 = EXCLUDED.normalized_phone_e164,
           verified_at = CASE
             WHEN user_phone_identities.normalized_phone_e164 =
                  EXCLUDED.normalized_phone_e164
               THEN user_phone_identities.verified_at
             ELSE NULL
           END,
           disabled_at = NULL,
           updated_at = EXCLUDED.updated_at
         RETURNING
           id,
           user_id,
           phone_e164,
           verified_at,
           disabled_at,
           created_at,
           updated_at`,
        [previous?.id ?? randomUUID(), userId, phone, occurredAt],
      );

      if (previous && previous.phone_e164 !== phone) {
        await client.query(
          `UPDATE phone_verification_challenges
           SET consumed_at = COALESCE(consumed_at, $2)
           WHERE phone_identity_id = $1`,
          [previous.id, occurredAt],
        );
      }

      return mapPhone(result.rows[0]);
    });
  }

  async removePhoneIdentity(userId: string, occurredAt: Date) {
    return this.database.withTransaction(async (client) => {
      const existing = await client.query<PhoneIdentityRow>(
        `SELECT
           id,
           user_id,
           phone_e164,
           verified_at,
           disabled_at,
           created_at,
           updated_at
         FROM user_phone_identities
         WHERE user_id = $1
         FOR UPDATE`,
        [userId],
      );
      const identity = existing.rows[0];

      if (!identity) {
        return false;
      }

      const destinationHash = hashNotificationDestination(identity.phone_e164);
      await client.query(
        `INSERT INTO notification_channel_consents (
           id,
           user_id,
           channel,
           destination_hash,
           action,
           source,
           occurred_at,
           metadata
         ) VALUES (
           $1, $2, 'sms', $3, 'opt_out', 'phone_removed', $4, '{}'::jsonb
         )`,
        [randomUUID(), userId, destinationHash, occurredAt],
      );
      await client.query(
        `UPDATE alert_deliveries
         SET status = 'suppressed',
             last_error_code = 'phone_identity_removed',
             last_error_message = 'Phone identity was removed before delivery.',
             updated_at = $2
         WHERE channel = 'sms'
           AND destination_hash = $1
           AND status IN ('queued', 'retry_wait')`,
        [destinationHash, occurredAt],
      );
      await client.query("DELETE FROM user_phone_identities WHERE id = $1", [identity.id]);
      await client.query(
        `UPDATE notification_preferences
         SET sms_enabled = FALSE,
             updated_at = $2
         WHERE user_id = $1`,
        [userId, occurredAt],
      );
      return true;
    });
  }

  async issuePhoneChallenge(input: {
    codeHash: string;
    expiresAt: Date;
    issuedAt: Date;
    userId: string;
  }) {
    return this.database.withTransaction(async (client) => {
      const identity = await client.query<PhoneIdentityRow>(
        `SELECT
           id,
           user_id,
           phone_e164,
           verified_at,
           disabled_at,
           created_at,
           updated_at
         FROM user_phone_identities
         WHERE user_id = $1
           AND disabled_at IS NULL
         FOR UPDATE`,
        [input.userId],
      );
      const phone = identity.rows[0];

      if (!phone) {
        return { status: "phone_missing" as const };
      }

      const verifiedOwner = await client.query(
        `SELECT id
         FROM user_phone_identities
         WHERE normalized_phone_e164 = $1
           AND verified_at IS NOT NULL
           AND disabled_at IS NULL
           AND id <> $2
         LIMIT 1`,
        [phone.phone_e164, phone.id],
      );

      // Deliberately return the same state as any other suppression so callers
      // cannot enumerate whether a phone belongs to another account.
      if (verifiedOwner.rows.length > 0) {
        return { status: "suppressed" as const };
      }

      const destinationHash = hashNotificationDestination(phone.phone_e164);
      const suppression = await client.query(
        `SELECT id
         FROM notification_suppressions
         WHERE channel = 'sms'
           AND destination_hash = $1
           AND released_at IS NULL
         LIMIT 1`,
        [destinationHash],
      );

      if (suppression.rows.length > 0) {
        return { status: "suppressed" as const };
      }

      const rateLimit = await client.query(
        `INSERT INTO phone_verification_rate_limits (
           destination_hash,
           last_sent_at,
           created_at,
           updated_at
         ) VALUES ($1, $2, $2, $2)
         ON CONFLICT (destination_hash) DO UPDATE SET
           last_sent_at = EXCLUDED.last_sent_at,
           updated_at = EXCLUDED.updated_at
         WHERE phone_verification_rate_limits.last_sent_at <= $3
         RETURNING destination_hash`,
        [destinationHash, input.issuedAt, new Date(input.issuedAt.getTime() - 60_000)],
      );

      if (rateLimit.rows.length === 0) {
        return { status: "cooldown" as const };
      }

      await client.query(
        `UPDATE phone_verification_challenges
         SET consumed_at = COALESCE(consumed_at, $2)
         WHERE phone_identity_id = $1
           AND consumed_at IS NULL`,
        [phone.id, input.issuedAt],
      );
      await client.query(
        `INSERT INTO phone_verification_challenges (
           id,
           phone_identity_id,
           code_hash,
           expires_at,
           created_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), phone.id, input.codeHash, input.expiresAt, input.issuedAt],
      );

      return {
        phoneIdentity: mapPhone(phone),
        status: "issued" as const,
      };
    });
  }

  async consumeActorRateLimit(input: {
    action: string;
    at: Date;
    limit: number;
    userId: string;
    windowMs: number;
  }) {
    const cutoff = new Date(input.at.getTime() - input.windowMs);
    const updated = await this.database.query(
      `UPDATE notification_actor_rate_limits
       SET
         window_started_at = CASE
           WHEN notification_actor_rate_limits.window_started_at <= $4
             THEN $3
           ELSE notification_actor_rate_limits.window_started_at
         END,
         attempt_count = CASE
           WHEN notification_actor_rate_limits.window_started_at <= $4
             THEN 1
           ELSE notification_actor_rate_limits.attempt_count + 1
         END,
         updated_at = $3
       WHERE user_id = $1
         AND action = $2
         AND (
           notification_actor_rate_limits.window_started_at <= $4
           OR notification_actor_rate_limits.attempt_count < $5
         )
       RETURNING attempt_count`,
      [input.userId, input.action, input.at, cutoff, Math.max(1, input.limit)],
    );

    if (updated.rows.length > 0) {
      return true;
    }

    const existing = await this.database.query(
      `SELECT attempt_count
       FROM notification_actor_rate_limits
       WHERE user_id = $1 AND action = $2`,
      [input.userId, input.action],
    );

    if (existing.rows.length > 0) {
      return false;
    }

    const inserted = await this.database.query(
      `INSERT INTO notification_actor_rate_limits (
         user_id,
         action,
         window_started_at,
         attempt_count,
         updated_at
       ) VALUES ($1, $2, $3, 1, $3)
       ON CONFLICT (user_id, action) DO NOTHING`,
      [input.userId, input.action, input.at],
    );
    return (inserted.rowCount ?? 0) > 0;
  }

  async verifyPhoneChallenge(
    userId: string,
    codeHash: string,
    verifiedAt: Date,
    maximumAttempts = 5,
  ) {
    return this.database.withTransaction(async (client) => {
      const result = await client.query<ChallengeRow>(
        `SELECT
           challenge.id,
           challenge.phone_identity_id,
           challenge.code_hash,
           challenge.expires_at,
           challenge.attempt_count,
           challenge.created_at
         FROM phone_verification_challenges challenge
         JOIN user_phone_identities phone
           ON phone.id = challenge.phone_identity_id
         WHERE phone.user_id = $1
           AND phone.disabled_at IS NULL
           AND challenge.consumed_at IS NULL
         ORDER BY challenge.created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [userId],
      );
      const challenge = result.rows[0];

      if (
        !challenge ||
        new Date(challenge.expires_at) < verifiedAt ||
        challenge.attempt_count >= maximumAttempts
      ) {
        return { status: "invalid_or_expired" as const };
      }

      if (challenge.code_hash !== codeHash) {
        await client.query(
          `UPDATE phone_verification_challenges
           SET attempt_count = attempt_count + 1
           WHERE id = $1`,
          [challenge.id],
        );
        return { status: "invalid_or_expired" as const };
      }

      const phone = await client.query<PhoneIdentityRow>(
        `SELECT
           id,
           user_id,
           phone_e164,
           verified_at,
           disabled_at,
           created_at,
           updated_at
         FROM user_phone_identities
         WHERE id = $1
         FOR UPDATE`,
        [challenge.phone_identity_id],
      );
      const identity = phone.rows[0];

      if (!identity) {
        return { status: "invalid_or_expired" as const };
      }

      await client.query(
        `SELECT destination_hash
         FROM phone_verification_rate_limits
         WHERE destination_hash = $1
         FOR UPDATE`,
        [hashNotificationDestination(identity.phone_e164)],
      );
      const existingVerified = await client.query(
        `SELECT id
         FROM user_phone_identities
         WHERE normalized_phone_e164 = $1
           AND verified_at IS NOT NULL
           AND disabled_at IS NULL
           AND id <> $2
         LIMIT 1`,
        [identity.phone_e164, identity.id],
      );

      if (existingVerified.rows.length > 0) {
        await client.query(
          `UPDATE phone_verification_challenges
           SET consumed_at = $2,
               attempt_count = attempt_count + 1
           WHERE id = $1`,
          [challenge.id, verifiedAt],
        );
        return { status: "phone_in_use" as const };
      }

      await client.query(
        `UPDATE phone_verification_challenges
         SET consumed_at = $2,
             attempt_count = attempt_count + 1
         WHERE id = $1`,
        [challenge.id, verifiedAt],
      );
      const phoneResult = await client.query<PhoneIdentityRow>(
        `UPDATE user_phone_identities
         SET verified_at = COALESCE(verified_at, $2),
             updated_at = $2
         WHERE id = $1
         RETURNING
           id,
           user_id,
           phone_e164,
           verified_at,
           disabled_at,
           created_at,
           updated_at`,
        [challenge.phone_identity_id, verifiedAt],
      );

      return {
        phoneIdentity: mapPhone(phoneResult.rows[0]),
        status: "verified" as const,
      };
    });
  }

  async recordConsent(input: {
    action: "opt_in" | "opt_out";
    channel: NotificationChannel;
    destination: string;
    metadata?: Record<string, unknown>;
    occurredAt: Date;
    source: string;
    userId?: string;
  }) {
    const destinationHash = hashNotificationDestination(input.destination);
    await this.database.query(
      `INSERT INTO notification_channel_consents (
         id,
         user_id,
         channel,
         destination_hash,
         action,
         source,
         occurred_at,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        randomUUID(),
        input.userId ?? null,
        input.channel,
        destinationHash,
        input.action,
        input.source,
        input.occurredAt,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return destinationHash;
  }

  async hasActiveConsent(channel: NotificationChannel, destination: string) {
    const result = await this.database.query<{ action: "opt_in" | "opt_out" }>(
      `SELECT action
       FROM notification_channel_consents
       WHERE channel = $1
         AND destination_hash = $2
       ORDER BY
         occurred_at DESC,
         CASE WHEN action = 'opt_out' THEN 1 ELSE 0 END DESC,
         id DESC
       LIMIT 1`,
      [channel, hashNotificationDestination(destination)],
    );

    return result.rows[0]?.action === "opt_in";
  }

  async suppressDestination(input: {
    channel: NotificationChannel;
    destination: string;
    metadata?: Record<string, unknown>;
    occurredAt: Date;
    providerEventId?: string;
    reason: "bounce" | "complaint" | "invalid_destination" | "manual" | "sms_stop" | "unsubscribe";
    userId?: string;
  }) {
    const destinationHash = hashNotificationDestination(input.destination);
    await persistActiveSuppression(this.database, {
      ...input,
      destinationHash,
    });
    await this.database.query(
      `UPDATE alert_deliveries
       SET status = 'suppressed',
           last_error_code = 'destination_suppressed',
           last_error_message = $3,
           updated_at = $4
       WHERE channel = $1
         AND destination_hash = $2
         AND status IN ('queued', 'retry_wait')`,
      [input.channel, destinationHash, input.reason, input.occurredAt],
    );
  }

  async releaseSmsStopSuppression(destination: string, releasedAt: Date) {
    const result = await this.database.query(
      `UPDATE notification_suppressions
       SET released_at = $2
       WHERE channel = 'sms'
         AND destination_hash = $1
         AND released_at IS NULL
         AND reason = 'sms_stop'`,
      [hashNotificationDestination(destination), releasedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async isSuppressed(channel: NotificationChannel, destination: string) {
    const result = await this.database.query(
      `SELECT id
       FROM notification_suppressions
       WHERE channel = $1
         AND destination_hash = $2
         AND released_at IS NULL
       LIMIT 1`,
      [channel, hashNotificationDestination(destination)],
    );
    return result.rows.length > 0;
  }

  async getWatchlistAlertSettings(userId: string, watchlistId: string) {
    const result = await this.database.query<WatchlistAlertSettingsRow>(
      `SELECT
         id,
         alert_event_types,
         alert_in_app_enabled,
         alert_email_enabled,
         alert_sms_enabled
       FROM watchlists
       WHERE id = $1 AND user_id = $2`,
      [watchlistId, userId],
    );
    return result.rows[0] ? mapWatchlistSettings(result.rows[0]) : undefined;
  }

  async updateWatchlistAlertSettings(input: {
    email?: boolean;
    eventTypes?: AlertEventType[];
    inApp?: boolean;
    sms?: boolean;
    userId: string;
    watchlistId: string;
  }) {
    const eventTypes = input.eventTypes ? Array.from(new Set(input.eventTypes)) : undefined;

    if (eventTypes?.some((eventType) => !allowedAlertEvents.has(eventType))) {
      throw new TypeError("Unknown alert event type.");
    }

    const result = await this.database.query<WatchlistAlertSettingsRow>(
      `UPDATE watchlists
       SET alert_event_types = COALESCE($3::jsonb, alert_event_types),
           alert_in_app_enabled = COALESCE($4, alert_in_app_enabled),
           alert_email_enabled = COALESCE($5, alert_email_enabled),
           alert_sms_enabled = COALESCE($6, alert_sms_enabled),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING
         id,
         alert_event_types,
         alert_in_app_enabled,
         alert_email_enabled,
         alert_sms_enabled`,
      [
        input.watchlistId,
        input.userId,
        eventTypes ? JSON.stringify(eventTypes) : null,
        input.inApp ?? null,
        input.email ?? null,
        input.sms ?? null,
      ],
    );
    return result.rows[0] ? mapWatchlistSettings(result.rows[0]) : undefined;
  }

  async storeEmailUnsubscribeToken(input: {
    createdAt: Date;
    destinationHash: string;
    expiresAt: Date;
    idempotencyKey: string;
    tokenHash: string;
    userId: string;
  }) {
    await this.database.query(
      `INSERT INTO notification_unsubscribe_tokens (
         id,
         user_id,
         destination_hash,
         idempotency_key,
         token_hash,
         expires_at,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        input.userId,
        input.destinationHash,
        input.idempotencyKey,
        input.tokenHash,
        input.expiresAt,
        input.createdAt,
      ],
    );
  }

  async findActiveEmailUnsubscribeToken(tokenHash: string, at: Date) {
    const result = await this.database.query<UnsubscribeTokenRow>(
      `SELECT id, user_id, destination_hash, expires_at, consumed_at
       FROM notification_unsubscribe_tokens
       WHERE token_hash = $1
         AND consumed_at IS NULL
         AND expires_at >= $2
       LIMIT 1`,
      [tokenHash, at],
    );
    const row = result.rows[0];

    return row
      ? {
          destinationHash: row.destination_hash,
          expiresAt: toIso(row.expires_at),
          id: row.id,
          userId: row.user_id,
        }
      : undefined;
  }

  async consumeEmailUnsubscribeToken(tokenId: string, consumedAt: Date) {
    const result = await this.database.query(
      `UPDATE notification_unsubscribe_tokens
       SET consumed_at = $2
       WHERE id = $1 AND consumed_at IS NULL`,
      [tokenId, consumedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async claimWebhookEvent(input: {
    eventType: string;
    payloadDigest: string;
    provider: "resend" | "twilio";
    providerEventId: string;
    receivedAt: Date;
    staleBefore: Date;
  }) {
    const claimToken = randomUUID();
    await this.database.query(
      `INSERT INTO notification_webhook_events (
         id,
         provider,
         provider_event_id,
         event_type,
         payload_digest,
         received_at
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider, provider_event_id) DO NOTHING`,
      [
        randomUUID(),
        input.provider,
        input.providerEventId,
        input.eventType,
        input.payloadDigest,
        input.receivedAt,
      ],
    );

    const claimed = await this.database.query(
      `UPDATE notification_webhook_events
       SET processing_started_at = $5,
           processing_claim_token = $7
       WHERE provider = $1
         AND provider_event_id = $2
         AND event_type = $3
         AND payload_digest = $4
         AND processed_at IS NULL
         AND (
           processing_started_at IS NULL
           OR processing_started_at <= $6
         )
       RETURNING id`,
      [
        input.provider,
        input.providerEventId,
        input.eventType,
        input.payloadDigest,
        input.receivedAt,
        input.staleBefore,
        claimToken,
      ],
    );

    if (claimed.rows.length > 0) {
      return { claimToken, status: "claimed" as const };
    }

    const existing = await this.database.query<{
      event_type: string;
      payload_digest: string;
      processed_at: Date | string | null;
    }>(
      `SELECT event_type, payload_digest, processed_at
       FROM notification_webhook_events
       WHERE provider = $1 AND provider_event_id = $2`,
      [input.provider, input.providerEventId],
    );
    const row = existing.rows[0];

    if (!row || row.event_type !== input.eventType || row.payload_digest !== input.payloadDigest) {
      return { status: "conflict" as const };
    }

    return {
      status: row.processed_at ? ("completed" as const) : ("in_progress" as const),
    };
  }

  async completeWebhookEvent(
    provider: "resend" | "twilio",
    providerEventId: string,
    claimToken: string,
    processedAt: Date,
  ) {
    const result = await this.database.query(
      `UPDATE notification_webhook_events
       SET processed_at = COALESCE(processed_at, $3),
           processing_started_at = NULL,
           processing_claim_token = NULL
       WHERE provider = $1
         AND provider_event_id = $2
         AND processing_claim_token = $4
         AND processed_at IS NULL`,
      [provider, providerEventId, processedAt, claimToken],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async releaseWebhookEventClaim(
    provider: "resend" | "twilio",
    providerEventId: string,
    claimToken: string,
  ) {
    const result = await this.database.query(
      `UPDATE notification_webhook_events
       SET processing_started_at = NULL,
           processing_claim_token = NULL
       WHERE provider = $1
         AND provider_event_id = $2
         AND processing_claim_token = $3
         AND processed_at IS NULL`,
      [provider, providerEventId, claimToken],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findUserIdByPhone(phoneValue: string) {
    const phone = normalizePhoneE164(phoneValue);
    const result = await this.database.query<{ user_id: string }>(
      `SELECT user_id
       FROM user_phone_identities
       WHERE normalized_phone_e164 = $1
         AND verified_at IS NOT NULL
         AND disabled_at IS NULL
       ORDER BY verified_at DESC, created_at, id
       LIMIT 1`,
      [phone],
    );
    return result.rows[0]?.user_id;
  }

  async findUserIdByEmail(emailValue: string) {
    const email = emailValue.trim().toLowerCase();
    const result = await this.database.query<{ user_id: string }>(
      `SELECT user_id
       FROM user_identities
       WHERE identity_type = 'email'
         AND normalized_email = $1
       LIMIT 1`,
      [email],
    );
    return result.rows[0]?.user_id;
  }

  async setChannelEnabled(userId: string, channel: NotificationChannel, enabled: boolean) {
    const column = channel === "email" ? "email_enabled" : "sms_enabled";
    await this.database.query(
      `INSERT INTO notification_preferences (
         user_id,
         ${column},
         updated_at
       ) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         ${column} = EXCLUDED.${column},
         updated_at = CURRENT_TIMESTAMP`,
      [userId, enabled],
    );
  }
}
