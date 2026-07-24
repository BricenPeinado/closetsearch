import { getDatabase } from "../database.js";

export interface UserEmailIdentityRecord {
  createdAt: string;
  email: string;
  id: string;
  normalizedEmail: string;
  updatedAt: string;
  userId: string;
  verifiedAt?: string;
}

interface UserEmailIdentityRow {
  created_at: string;
  email: string;
  id: string;
  normalized_email: string;
  updated_at: string;
  user_id: string;
  verified_at: string | null;
}

const selectColumns = `
  id,
  user_id,
  email,
  normalized_email,
  verified_at,
  created_at,
  updated_at
`;

function mapUserEmailIdentityRow(row: UserEmailIdentityRow): UserEmailIdentityRecord {
  return {
    createdAt: row.created_at,
    email: row.email,
    id: row.id,
    normalizedEmail: row.normalized_email,
    updatedAt: row.updated_at,
    userId: row.user_id,
    verifiedAt: row.verified_at ?? undefined,
  };
}

export function findUserEmailIdentityById(identityId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT ${selectColumns}
      FROM user_email_identities
      WHERE id = ?`,
    )
    .get(identityId) as UserEmailIdentityRow | undefined;

  return row ? mapUserEmailIdentityRow(row) : undefined;
}

export function findUserEmailIdentityByUserId(userId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT ${selectColumns}
      FROM user_email_identities
      WHERE user_id = ?`,
    )
    .get(userId) as UserEmailIdentityRow | undefined;

  return row ? mapUserEmailIdentityRow(row) : undefined;
}

export function findUserEmailIdentityByNormalizedEmail(normalizedEmail: string) {
  const row = getDatabase()
    .prepare(
      `SELECT ${selectColumns}
      FROM user_email_identities
      WHERE normalized_email = ?`,
    )
    .get(normalizedEmail) as UserEmailIdentityRow | undefined;

  return row ? mapUserEmailIdentityRow(row) : undefined;
}

export function upsertUserEmailIdentity(input: {
  createdAt: string;
  email: string;
  id: string;
  normalizedEmail: string;
  updatedAt: string;
  userId: string;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO user_email_identities (
        id,
        user_id,
        email,
        normalized_email,
        verified_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email,
        normalized_email = excluded.normalized_email,
        verified_at = CASE
          WHEN user_email_identities.normalized_email = excluded.normalized_email
            THEN user_email_identities.verified_at
          ELSE NULL
        END,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.id,
      input.userId,
      input.email,
      input.normalizedEmail,
      input.createdAt,
      input.updatedAt,
    );

  return findUserEmailIdentityByUserId(input.userId) as UserEmailIdentityRecord;
}

export function markUserEmailIdentityVerified(
  identityId: string,
  userId: string,
  verifiedAt: string,
) {
  const result = getDatabase()
    .prepare(
      `UPDATE user_email_identities
      SET verified_at = COALESCE(verified_at, ?),
          updated_at = ?
      WHERE id = ? AND user_id = ?`,
    )
    .run(verifiedAt, verifiedAt, identityId, userId);

  return result.changes > 0 ? findUserEmailIdentityById(identityId) : undefined;
}

export function listUserEmailIdentitiesByUserId(userId: string) {
  return (
    getDatabase()
      .prepare(
        `SELECT ${selectColumns}
        FROM user_email_identities
        WHERE user_id = ?
        ORDER BY created_at, id`,
      )
      .all(userId) as unknown as UserEmailIdentityRow[]
  ).map(mapUserEmailIdentityRow);
}

export function clearUserEmailIdentities() {
  getDatabase().prepare("DELETE FROM user_email_identities").run();
}
