import { randomUUID } from "node:crypto";
import type {
  OnboardingPreferences,
  StoredUser,
  UpdateUserSettingsInput,
  User,
  UserSettings,
} from "@closetsearch/shared";
import type { QueryResultRow } from "pg";
import { normalizeEmailAddress } from "../../../auth/email-address.js";
import type { PgQueryable } from "../types.js";
import {
  assertUuid,
  isUniqueViolation,
  normalizeBoundedString,
  normalizeCurrency,
  normalizeHash,
  normalizeOnboardingPreferences,
  normalizeUsername,
  parseJsonArray,
  parseOnboardingPreferences,
  sha256,
  toIso,
} from "../request-store-common.js";
import {
  RequestStoreError,
  type AccountTokenPurpose,
  type AccountTokenRecord,
  type CreateRequestSessionInput,
  type CreateRequestUserInput,
  type EmailIdentityRecord,
  type RequestAuthSession,
  type RequestStoreOptions,
} from "../request-store-types.js";

interface UserRow extends QueryResultRow {
  created_at: Date | string;
  id: string;
  onboarding_preferences: unknown;
  password_hash: string;
  preferred_currency: string;
  username: string;
}

interface EmailIdentityRow extends QueryResultRow {
  created_at: Date | string;
  id: string;
  normalized_email: string | null;
  provider_subject: string;
  updated_at: Date | string;
  user_id: string;
  verified_at: Date | string | null;
}

interface AccountTokenRow extends QueryResultRow {
  consumed_at: Date | string | null;
  created_at: Date | string;
  expires_at: Date | string;
  id: string;
  identity_id: string | null;
  invalidated_at: Date | string | null;
  invalidation_reason: string | null;
  purpose: AccountTokenPurpose;
  user_id: string;
}

interface SessionRow extends QueryResultRow {
  created_at: Date | string;
  expires_at: Date | string;
  id: string;
  ip_hint_recorded: boolean;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
  user_agent: string | null;
  user_id: string;
}

interface SettingsRow extends QueryResultRow {
  created_at: Date | string;
  default_sort_mode: UserSettings["defaultSortMode"] | null;
  display_name: string | null;
  preferred_currency: string;
  preferred_sources: unknown;
  updated_at: Date | string;
  user_id: string;
}

const userSelect = `
  SELECT
    u.id,
    u.username,
    u.password_hash,
    u.created_at,
    COALESCE(s.preferred_currency, 'USD') AS preferred_currency,
    COALESCE(s.onboarding_preferences, '{}'::jsonb) AS onboarding_preferences
  FROM users u
  LEFT JOIN user_settings s ON s.user_id = u.id
`;

const emailIdentitySelect = `
  SELECT
    id,
    user_id,
    provider_subject,
    normalized_email,
    verified_at,
    created_at,
    updated_at
  FROM user_identities
`;

const accountTokenSelect = `
  SELECT
    id,
    user_id,
    identity_id,
    purpose,
    created_at,
    expires_at,
    consumed_at,
    invalidated_at,
    invalidation_reason
  FROM account_tokens
`;

const sessionSelect = `
  SELECT
    id,
    user_id,
    created_at,
    expires_at,
    last_seen_at,
    revoked_at,
    user_agent,
    (ip_hint_hash IS NOT NULL) AS ip_hint_recorded
  FROM auth_sessions
`;

function mapUser(row: UserRow): User {
  return {
    createdAt: toIso(row.created_at),
    currencyPreference: row.preferred_currency,
    id: row.id,
    onboardingPreferences: parseOnboardingPreferences(row.onboarding_preferences),
    username: row.username,
  };
}

function mapStoredUser(row: UserRow): StoredUser {
  return {
    ...mapUser(row),
    passwordHash: row.password_hash,
  };
}

function mapEmailIdentity(row: EmailIdentityRow): EmailIdentityRecord {
  return {
    createdAt: toIso(row.created_at),
    email: row.provider_subject,
    id: row.id,
    normalizedEmail: row.normalized_email ?? row.provider_subject.toLowerCase(),
    updatedAt: toIso(row.updated_at),
    userId: row.user_id,
    verifiedAt: row.verified_at ? toIso(row.verified_at) : undefined,
  };
}

function mapAccountToken(row: AccountTokenRow): AccountTokenRecord {
  return {
    consumedAt: row.consumed_at ? toIso(row.consumed_at) : undefined,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    id: row.id,
    emailIdentityId: row.identity_id ?? undefined,
    invalidatedAt: row.invalidated_at ? toIso(row.invalidated_at) : undefined,
    invalidationReason: row.invalidation_reason ?? undefined,
    purpose: row.purpose,
    userId: row.user_id,
  };
}

function mapSession(row: SessionRow): RequestAuthSession {
  return {
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    id: row.id,
    ipHintRecorded: row.ip_hint_recorded,
    lastSeenAt: toIso(row.last_seen_at),
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : undefined,
    userAgent: row.user_agent ?? undefined,
    userId: row.user_id,
  };
}

function mapSettings(row: SettingsRow): UserSettings {
  return {
    createdAt: toIso(row.created_at),
    defaultSortMode: row.default_sort_mode ?? undefined,
    displayName: row.display_name ?? undefined,
    preferredCurrency: row.preferred_currency,
    preferredSources: parseJsonArray(row.preferred_sources).filter(
      (entry): entry is string => typeof entry === "string",
    ),
    updatedAt: toIso(row.updated_at),
    userId: row.user_id,
  };
}

function normalizeEmail(value: string) {
  try {
    return normalizeEmailAddress(value);
  } catch {
    throw new RequestStoreError("invalid_email", "Enter a valid email address.");
  }
}

function normalizeTokenPurpose(value: AccountTokenPurpose) {
  if (value !== "account_export" && value !== "email_verification" && value !== "password_reset") {
    throw new RequestStoreError("invalid_account_token", "Account token purpose is unsupported.");
  }

  return value;
}

function normalizeSortMode(value: UserSettings["defaultSortMode"] | null) {
  if (
    value !== null &&
    value !== undefined &&
    value !== "newest" &&
    value !== "price_asc" &&
    value !== "price_desc" &&
    value !== "relevance"
  ) {
    throw new RequestStoreError("invalid_saved_feature", "Default sort mode is unsupported.");
  }

  return value;
}

export class RequestAccountRepository {
  constructor(
    private readonly queryable: PgQueryable,
    private readonly options: RequestStoreOptions = {},
  ) {}

  async createUser(input: CreateRequestUserInput) {
    const identity = normalizeUsername(input.username);
    const userId = input.id ? assertUuid(input.id, "User ID") : randomUUID();
    const createdAt = input.createdAt ?? new Date();
    const passwordHash = normalizeHash(
      input.passwordHash,
      "invalid_password_hash",
      "Password hash",
    );
    const currency = normalizeCurrency(input.currencyPreference ?? input.preferredCurrency);
    const preferences = normalizeOnboardingPreferences(input.onboardingPreferences);

    try {
      await this.queryable.query(
        `INSERT INTO users (
           id,
           username,
           normalized_username,
           password_hash,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $5)`,
        [userId, identity.username, identity.normalizedUsername, passwordHash, createdAt],
      );
      await this.queryable.query(
        `INSERT INTO user_settings (
           user_id,
           preferred_currency,
           preferred_sources,
           onboarding_preferences,
           created_at,
           updated_at
         ) VALUES ($1, $2, '[]'::jsonb, $3::jsonb, $4, $4)`,
        [userId, currency, JSON.stringify(preferences), createdAt],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new RequestStoreError("username_taken", "Username is already in use.");
      }

      throw error;
    }

    return this.findUserById(userId) as Promise<User>;
  }

  async findUserById(userId: string) {
    const result = await this.queryable.query<UserRow>(
      `${userSelect}
       WHERE u.id = $1
         AND u.deleted_at IS NULL`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async findCredentialsByNormalizedUsername(normalizedUsername: string) {
    const identity = normalizeUsername(normalizedUsername);
    const result = await this.queryable.query<UserRow>(
      `${userSelect}
       WHERE u.normalized_username = $1
         AND u.deleted_at IS NULL`,
      [identity.normalizedUsername],
    );

    return result.rows[0] ? mapStoredUser(result.rows[0]) : undefined;
  }

  async updatePasswordHash(userId: string, passwordHash: string) {
    const result = await this.queryable.query(
      `UPDATE users
       SET password_hash = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND deleted_at IS NULL`,
      [
        assertUuid(userId, "User ID"),
        normalizeHash(passwordHash, "invalid_password_hash", "Password hash"),
      ],
    );

    return result.rowCount === 1;
  }

  async deleteUser(userId: string, normalizedUsername?: string) {
    const values: unknown[] = [assertUuid(userId, "User ID")];
    const usernameClause = normalizedUsername ? "AND normalized_username = $2" : "";

    if (normalizedUsername) {
      values.push(normalizeUsername(normalizedUsername).normalizedUsername);
    }

    const result = await this.queryable.query(
      `DELETE FROM users
       WHERE id = $1
       ${usernameClause}`,
      values,
    );

    return result.rowCount === 1;
  }

  async findEmailIdentityByUserId(userId: string) {
    const result = await this.queryable.query<EmailIdentityRow>(
      `${emailIdentitySelect}
       WHERE user_id = $1
         AND identity_type = 'email'
       ORDER BY created_at, id
       LIMIT 1`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows[0] ? mapEmailIdentity(result.rows[0]) : undefined;
  }

  async findEmailIdentityById(identityId: string) {
    const result = await this.queryable.query<EmailIdentityRow>(
      `${emailIdentitySelect}
       WHERE id = $1
         AND identity_type = 'email'
       LIMIT 1`,
      [assertUuid(identityId, "Identity ID")],
    );

    return result.rows[0] ? mapEmailIdentity(result.rows[0]) : undefined;
  }

  async findEmailIdentityByNormalizedEmail(email: string) {
    const normalized = normalizeEmail(email);
    const result = await this.queryable.query<EmailIdentityRow>(
      `${emailIdentitySelect}
       WHERE normalized_email = $1
         AND identity_type = 'email'
       LIMIT 1`,
      [normalized.normalizedEmail],
    );

    return result.rows[0] ? mapEmailIdentity(result.rows[0]) : undefined;
  }

  async listEmailIdentities(userId: string) {
    const result = await this.queryable.query<EmailIdentityRow>(
      `${emailIdentitySelect}
       WHERE user_id = $1
         AND identity_type = 'email'
       ORDER BY created_at, id`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows.map(mapEmailIdentity);
  }

  async upsertEmailIdentity(input: {
    createdAt?: Date;
    email: string;
    id?: string;
    userId: string;
  }) {
    const userId = assertUuid(input.userId, "User ID");
    const identityId = input.id ? assertUuid(input.id, "Identity ID") : randomUUID();
    const email = normalizeEmail(input.email);
    const createdAt = input.createdAt ?? new Date();

    try {
      const existing = await this.findEmailIdentityByUserId(userId);

      if (existing) {
        const result = await this.queryable.query<EmailIdentityRow>(
          `UPDATE user_identities
           SET provider_subject = $2,
               normalized_email = $3,
               verified_at = CASE
                 WHEN normalized_email = $3 THEN verified_at
                 ELSE NULL
               END,
               updated_at = $4
           WHERE id = $1
           RETURNING
             id,
             user_id,
             provider_subject,
             normalized_email,
             verified_at,
             created_at,
             updated_at`,
          [existing.id, email.email, email.normalizedEmail, createdAt],
        );

        return mapEmailIdentity(result.rows[0]);
      }

      const result = await this.queryable.query<EmailIdentityRow>(
        `INSERT INTO user_identities (
           id,
           user_id,
           identity_type,
           provider,
           provider_subject,
           normalized_email,
           created_at,
           updated_at
         ) VALUES ($1, $2, 'email', 'email', $3, $4, $5, $5)
         RETURNING
           id,
           user_id,
           provider_subject,
           normalized_email,
           verified_at,
           created_at,
           updated_at`,
        [identityId, userId, email.email, email.normalizedEmail, createdAt],
      );

      return mapEmailIdentity(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new RequestStoreError("email_in_use", "Email address is already in use.");
      }

      throw error;
    }
  }

  async markEmailVerified(identityId: string, userId: string, verifiedAt = new Date()) {
    const result = await this.queryable.query<EmailIdentityRow>(
      `UPDATE user_identities
       SET verified_at = COALESCE(verified_at, $3),
           updated_at = GREATEST(updated_at, $3)
       WHERE id = $1
         AND user_id = $2
         AND identity_type = 'email'
       RETURNING
         id,
         user_id,
         provider_subject,
         normalized_email,
         verified_at,
         created_at,
         updated_at`,
      [assertUuid(identityId, "Identity ID"), assertUuid(userId, "User ID"), verifiedAt],
    );

    return result.rows[0] ? mapEmailIdentity(result.rows[0]) : undefined;
  }

  async insertAccountToken(input: {
    createdAt?: Date;
    expiresAt: Date;
    id?: string;
    emailIdentityId?: string;
    purpose: AccountTokenPurpose;
    tokenHash: string;
    userId: string;
  }) {
    const createdAt = input.createdAt ?? new Date();

    if (input.expiresAt <= createdAt) {
      throw new RequestStoreError(
        "invalid_account_token",
        "Account token expiry must be after creation.",
      );
    }

    try {
      const result = await this.queryable.query<AccountTokenRow>(
        `INSERT INTO account_tokens (
           id,
           user_id,
           identity_id,
           purpose,
           token_hash,
           created_at,
           expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING
           id,
           user_id,
           identity_id,
           purpose,
           created_at,
           expires_at,
           consumed_at,
           invalidated_at,
           invalidation_reason`,
        [
          input.id ? assertUuid(input.id, "Token ID") : randomUUID(),
          assertUuid(input.userId, "User ID"),
          input.emailIdentityId ? assertUuid(input.emailIdentityId, "Identity ID") : null,
          normalizeTokenPurpose(input.purpose),
          normalizeHash(input.tokenHash, "invalid_account_token", "Account token hash"),
          createdAt,
          input.expiresAt,
        ],
      );

      return mapAccountToken(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new RequestStoreError(
          "account_token_conflict",
          "Account token hash has already been issued.",
        );
      }

      throw error;
    }
  }

  async findActiveAccountToken(tokenHash: string, purpose: AccountTokenPurpose, at = new Date()) {
    const result = await this.queryable.query<AccountTokenRow>(
      `${accountTokenSelect}
       WHERE token_hash = $1
         AND purpose = $2
         AND consumed_at IS NULL
         AND invalidated_at IS NULL
         AND expires_at > $3
       LIMIT 1`,
      [
        normalizeHash(tokenHash, "invalid_account_token", "Account token hash"),
        normalizeTokenPurpose(purpose),
        at,
      ],
    );

    return result.rows[0] ? mapAccountToken(result.rows[0]) : undefined;
  }

  async consumeActiveAccountToken(
    tokenHash: string,
    purpose: AccountTokenPurpose,
    consumedAt = new Date(),
  ) {
    const result = await this.queryable.query<AccountTokenRow>(
      `UPDATE account_tokens
       SET consumed_at = $3
       WHERE token_hash = $1
         AND purpose = $2
         AND consumed_at IS NULL
         AND invalidated_at IS NULL
         AND expires_at > $3
       RETURNING
         id,
         user_id,
         identity_id,
         purpose,
         created_at,
         expires_at,
         consumed_at,
         invalidated_at,
         invalidation_reason`,
      [
        normalizeHash(tokenHash, "invalid_account_token", "Account token hash"),
        normalizeTokenPurpose(purpose),
        consumedAt,
      ],
    );

    return result.rows[0] ? mapAccountToken(result.rows[0]) : undefined;
  }

  async invalidateActiveAccountTokens(input: {
    invalidatedAt?: Date;
    purpose?: AccountTokenPurpose;
    reason: string;
    userId: string;
  }) {
    const reason = normalizeBoundedString(input.reason, 200);

    if (!reason) {
      throw new RequestStoreError(
        "invalid_account_token",
        "Account token invalidation reason is required.",
      );
    }

    const values: unknown[] = [
      assertUuid(input.userId, "User ID"),
      input.invalidatedAt ?? new Date(),
      reason,
    ];
    const purposeClause = input.purpose ? "AND purpose = $4" : "";

    if (input.purpose) {
      values.push(normalizeTokenPurpose(input.purpose));
    }

    const result = await this.queryable.query(
      `UPDATE account_tokens
       SET invalidated_at = $2,
           invalidation_reason = $3
       WHERE user_id = $1
         AND consumed_at IS NULL
         AND invalidated_at IS NULL
         ${purposeClause}`,
      values,
    );

    return result.rowCount;
  }

  async deleteExpiredAccountTokens(expiredAt: Date, createdBefore: Date, limit = 1_000) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 10_000);
    const result = await this.queryable.query(
      `DELETE FROM account_tokens
       WHERE id IN (
         SELECT id
         FROM account_tokens
         WHERE expires_at <= $1
           AND created_at < $2
         ORDER BY expires_at, id
         LIMIT $3
       )`,
      [expiredAt, createdBefore, safeLimit],
    );

    return result.rowCount;
  }

  async createSession(input: CreateRequestSessionInput) {
    const createdAt = input.createdAt ?? new Date();

    if (input.expiresAt <= createdAt) {
      throw new RequestStoreError("invalid_session", "Session expiry must be after creation.");
    }

    const ipHint = normalizeBoundedString(input.ipHint, 256);
    const configuredPepper =
      this.options.ipHintPepper?.trim() || process.env.REQUEST_STORE_IP_HINT_PEPPER?.trim() || "";
    const nodeEnv = this.options.nodeEnv ?? process.env.NODE_ENV;

    if (ipHint && nodeEnv === "production" && configuredPepper.length < 32) {
      throw new RequestStoreError(
        "invalid_ip_hint_configuration",
        "REQUEST_STORE_IP_HINT_PEPPER must contain at least 32 characters before IP hints can be persisted.",
      );
    }

    const developmentPepper = configuredPepper || "closetsearch-development-ip-hint-pepper";
    const userAgent = normalizeBoundedString(input.userAgent, 512);
    const result = await this.queryable.query<SessionRow>(
      `INSERT INTO auth_sessions (
         id,
         user_id,
         session_token_hash,
         created_at,
         expires_at,
         last_seen_at,
         user_agent,
         ip_hint_hash
       ) VALUES ($1, $2, $3, $4, $5, $4, $6, $7)
       RETURNING
         id,
         user_id,
         created_at,
         expires_at,
         last_seen_at,
         revoked_at,
         user_agent,
         (ip_hint_hash IS NOT NULL) AS ip_hint_recorded`,
      [
        input.id ? assertUuid(input.id, "Session ID") : randomUUID(),
        assertUuid(input.userId, "User ID"),
        normalizeHash(input.sessionTokenHash, "invalid_session", "Session token hash"),
        createdAt,
        input.expiresAt,
        userAgent ?? null,
        ipHint ? sha256("ip-hint-v1", developmentPepper, ipHint) : null,
      ],
    );

    return mapSession(result.rows[0]);
  }

  async findSessionByTokenHash(sessionTokenHash: string) {
    const result = await this.queryable.query<SessionRow>(
      `${sessionSelect}
       WHERE session_token_hash = $1
       LIMIT 1`,
      [normalizeHash(sessionTokenHash, "invalid_session", "Session token hash")],
    );

    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async findActiveSession(sessionTokenHash: string, at = new Date()) {
    const result = await this.queryable.query<SessionRow>(
      `${sessionSelect}
       WHERE session_token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > $2
       LIMIT 1`,
      [normalizeHash(sessionTokenHash, "invalid_session", "Session token hash"), at],
    );

    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async touchSession(sessionId: string, seenAt = new Date()) {
    const result = await this.queryable.query<SessionRow>(
      `UPDATE auth_sessions
       SET last_seen_at = GREATEST(last_seen_at, $2)
       WHERE id = $1
         AND revoked_at IS NULL
         AND expires_at > $2
       RETURNING
         id,
         user_id,
         created_at,
         expires_at,
         last_seen_at,
         revoked_at,
         user_agent,
         (ip_hint_hash IS NOT NULL) AS ip_hint_recorded`,
      [assertUuid(sessionId, "Session ID"), seenAt],
    );

    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async touchSessionByTokenHash(sessionTokenHash: string, seenAt = new Date()) {
    const result = await this.queryable.query<SessionRow>(
      `UPDATE auth_sessions
       SET last_seen_at = GREATEST(last_seen_at, $2)
       WHERE session_token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > $2
       RETURNING
         id,
         user_id,
         created_at,
         expires_at,
         last_seen_at,
         revoked_at,
         user_agent,
         (ip_hint_hash IS NOT NULL) AS ip_hint_recorded`,
      [normalizeHash(sessionTokenHash, "invalid_session", "Session token hash"), seenAt],
    );

    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async revokeSession(sessionTokenHash: string, revokedAt = new Date()) {
    const result = await this.queryable.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, $2)
       WHERE session_token_hash = $1`,
      [normalizeHash(sessionTokenHash, "invalid_session", "Session token hash"), revokedAt],
    );

    return result.rowCount === 1;
  }

  async revokeSessionsForUser(userId: string, revokedAt = new Date()) {
    const result = await this.queryable.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, $2)
       WHERE user_id = $1
         AND revoked_at IS NULL`,
      [assertUuid(userId, "User ID"), revokedAt],
    );

    return result.rowCount;
  }

  async listSessions(userId: string) {
    const result = await this.queryable.query<SessionRow>(
      `${sessionSelect}
       WHERE user_id = $1
       ORDER BY created_at, id`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows.map(mapSession);
  }

  async getSettings(userId: string) {
    const result = await this.queryable.query<SettingsRow>(
      `SELECT
         u.id AS user_id,
         COALESCE(s.preferred_currency, 'USD') AS preferred_currency,
         s.default_sort_mode,
         s.display_name,
         COALESCE(s.preferred_sources, '[]'::jsonb) AS preferred_sources,
         COALESCE(s.created_at, u.created_at) AS created_at,
         COALESCE(s.updated_at, u.updated_at) AS updated_at
       FROM users u
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE u.id = $1
         AND u.deleted_at IS NULL`,
      [assertUuid(userId, "User ID")],
    );

    return result.rows[0] ? mapSettings(result.rows[0]) : undefined;
  }

  async updateSettings(input: UpdateUserSettingsInput) {
    const current = await this.getSettings(input.userId);

    if (!current) {
      return undefined;
    }

    const preferredCurrency =
      input.preferredCurrency === undefined
        ? current.preferredCurrency
        : normalizeCurrency(input.preferredCurrency);
    const displayName =
      input.displayName === null
        ? null
        : input.displayName === undefined
          ? (current.displayName ?? null)
          : (normalizeBoundedString(input.displayName, 120) ?? null);
    const defaultSortMode =
      input.defaultSortMode === undefined
        ? (current.defaultSortMode ?? null)
        : normalizeSortMode(input.defaultSortMode);
    const preferredSources =
      input.preferredSources === undefined
        ? current.preferredSources
        : Array.from(
            new Set(
              input.preferredSources
                .map((source) => normalizeBoundedString(source, 80))
                .filter((source): source is string => Boolean(source)),
            ),
          ).slice(0, 100);
    const result = await this.queryable.query<SettingsRow>(
      `INSERT INTO user_settings (
         user_id,
         display_name,
         preferred_currency,
         default_sort_mode,
         preferred_sources,
         onboarding_preferences,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, '{}'::jsonb, $6, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         preferred_currency = EXCLUDED.preferred_currency,
         default_sort_mode = EXCLUDED.default_sort_mode,
         preferred_sources = EXCLUDED.preferred_sources,
         updated_at = EXCLUDED.updated_at
       RETURNING
         user_id,
         preferred_currency,
         default_sort_mode,
         display_name,
         preferred_sources,
         created_at,
         updated_at`,
      [
        assertUuid(input.userId, "User ID"),
        displayName,
        preferredCurrency,
        defaultSortMode,
        JSON.stringify(preferredSources),
        new Date(),
      ],
    );

    return mapSettings(result.rows[0]);
  }

  async updateOnboarding(
    userId: string,
    preferences: OnboardingPreferences,
    preferredCurrency: string,
  ) {
    const result = await this.queryable.query(
      `UPDATE user_settings
       SET onboarding_preferences = $2::jsonb,
           preferred_currency = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [
        assertUuid(userId, "User ID"),
        JSON.stringify(normalizeOnboardingPreferences(preferences)),
        normalizeCurrency(preferredCurrency),
      ],
    );

    return result.rowCount === 1 ? this.findUserById(userId) : undefined;
  }
}
