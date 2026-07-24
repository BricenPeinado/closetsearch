import { getDatabase } from "../database.js";

export type AccountTokenPurpose = "account_export" | "email_verification" | "password_reset";

export interface AccountTokenRecord {
  consumedAt?: string;
  createdAt: string;
  emailIdentityId?: string;
  expiresAt: string;
  id: string;
  invalidatedAt?: string;
  invalidationReason?: string;
  purpose: AccountTokenPurpose;
  tokenHash: string;
  userId: string;
}

interface AccountTokenRow {
  consumed_at: string | null;
  created_at: string;
  email_identity_id: string | null;
  expires_at: string;
  id: string;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  purpose: AccountTokenPurpose;
  token_hash: string;
  user_id: string;
}

const selectColumns = `
  id,
  user_id,
  email_identity_id,
  purpose,
  token_hash,
  created_at,
  expires_at,
  consumed_at,
  invalidated_at,
  invalidation_reason
`;

function mapAccountTokenRow(row: AccountTokenRow): AccountTokenRecord {
  return {
    consumedAt: row.consumed_at ?? undefined,
    createdAt: row.created_at,
    emailIdentityId: row.email_identity_id ?? undefined,
    expiresAt: row.expires_at,
    id: row.id,
    invalidatedAt: row.invalidated_at ?? undefined,
    invalidationReason: row.invalidation_reason ?? undefined,
    purpose: row.purpose,
    tokenHash: row.token_hash,
    userId: row.user_id,
  };
}

export function insertAccountToken(token: AccountTokenRecord) {
  getDatabase()
    .prepare(
      `INSERT INTO account_tokens (
        id,
        user_id,
        email_identity_id,
        purpose,
        token_hash,
        created_at,
        expires_at,
        consumed_at,
        invalidated_at,
        invalidation_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      token.id,
      token.userId,
      token.emailIdentityId ?? null,
      token.purpose,
      token.tokenHash,
      token.createdAt,
      token.expiresAt,
      token.consumedAt ?? null,
      token.invalidatedAt ?? null,
      token.invalidationReason ?? null,
    );
}

export function findAccountTokenByHash(tokenHash: string) {
  const row = getDatabase()
    .prepare(
      `SELECT ${selectColumns}
      FROM account_tokens
      WHERE token_hash = ?`,
    )
    .get(tokenHash) as AccountTokenRow | undefined;

  return row ? mapAccountTokenRow(row) : undefined;
}

export function consumeActiveAccountToken(input: {
  consumedAt: string;
  purpose: AccountTokenPurpose;
  tokenHash: string;
}) {
  const result = getDatabase()
    .prepare(
      `UPDATE account_tokens
      SET consumed_at = ?
      WHERE token_hash = ?
        AND purpose = ?
        AND consumed_at IS NULL
        AND invalidated_at IS NULL
        AND expires_at > ?`,
    )
    .run(input.consumedAt, input.tokenHash, input.purpose, input.consumedAt);

  return result.changes === 1 ? findAccountTokenByHash(input.tokenHash) : undefined;
}

export function invalidateActiveAccountTokens(input: {
  invalidatedAt: string;
  reason: string;
  purpose?: AccountTokenPurpose;
  userId: string;
}) {
  const purposeClause = input.purpose ? "AND purpose = ?" : "";
  const parameters = input.purpose
    ? [input.invalidatedAt, input.reason, input.userId, input.purpose]
    : [input.invalidatedAt, input.reason, input.userId];
  const result = getDatabase()
    .prepare(
      `UPDATE account_tokens
      SET invalidated_at = ?,
          invalidation_reason = ?
      WHERE user_id = ?
        ${purposeClause}
        AND consumed_at IS NULL
        AND invalidated_at IS NULL`,
    )
    .run(...parameters);

  return result.changes;
}

export function deleteExpiredAccountTokens(expiredBefore: string, retainedAfter: string) {
  const result = getDatabase()
    .prepare(
      `DELETE FROM account_tokens
      WHERE expires_at <= ?
        AND created_at < ?`,
    )
    .run(expiredBefore, retainedAfter);

  return result.changes;
}

export function listAccountTokensByUserId(userId: string) {
  return (
    getDatabase()
      .prepare(
        `SELECT ${selectColumns}
        FROM account_tokens
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC`,
      )
      .all(userId) as unknown as AccountTokenRow[]
  ).map(mapAccountTokenRow);
}

export function clearAccountTokens() {
  getDatabase().prepare("DELETE FROM account_tokens").run();
}
