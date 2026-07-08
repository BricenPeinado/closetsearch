import { getDatabase } from "../database.js";

export interface AuthSessionRecord {
  createdAt: string;
  expiresAt: string;
  id: string;
  ipHint?: string;
  lastSeenAt: string;
  revokedAt?: string;
  sessionTokenHash: string;
  userAgent?: string;
  userId: string;
}

interface AuthSessionRow {
  created_at: string;
  expires_at: string;
  id: string;
  ip_hint: string | null;
  last_seen_at: string;
  revoked_at: string | null;
  session_token_hash: string;
  user_agent: string | null;
  user_id: string;
}

function mapAuthSessionRow(row: AuthSessionRow): AuthSessionRecord {
  return {
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    ipHint: row.ip_hint ?? undefined,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at ?? undefined,
    sessionTokenHash: row.session_token_hash,
    userAgent: row.user_agent ?? undefined,
    userId: row.user_id,
  };
}

export function insertAuthSession(session: AuthSessionRecord) {
  getDatabase()
    .prepare(
      `INSERT INTO auth_sessions (
        id,
        user_id,
        session_token_hash,
        created_at,
        expires_at,
        last_seen_at,
        revoked_at,
        user_agent,
        ip_hint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      session.id,
      session.userId,
      session.sessionTokenHash,
      session.createdAt,
      session.expiresAt,
      session.lastSeenAt,
      session.revokedAt ?? null,
      session.userAgent ?? null,
      session.ipHint ?? null,
    );
}

export function findAuthSessionByTokenHash(sessionTokenHash: string) {
  const row = getDatabase()
    .prepare(
      `SELECT
        id,
        user_id,
        session_token_hash,
        created_at,
        expires_at,
        last_seen_at,
        revoked_at,
        user_agent,
        ip_hint
      FROM auth_sessions
      WHERE session_token_hash = ?`,
    )
    .get(sessionTokenHash) as AuthSessionRow | undefined;

  return row ? mapAuthSessionRow(row) : undefined;
}

export function touchAuthSession(sessionId: string, lastSeenAt: string) {
  getDatabase()
    .prepare(
      `UPDATE auth_sessions
      SET last_seen_at = ?
      WHERE id = ?`,
    )
    .run(lastSeenAt, sessionId);
}

export function revokeAuthSessionByTokenHash(
  sessionTokenHash: string,
  revokedAt: string,
) {
  const result = getDatabase()
    .prepare(
      `UPDATE auth_sessions
      SET revoked_at = CASE
        WHEN revoked_at IS NULL THEN ?
        ELSE revoked_at
      END
      WHERE session_token_hash = ?`,
    )
    .run(revokedAt, sessionTokenHash);

  return result.changes > 0;
}

export function revokeAuthSessionsByUserId(userId: string, revokedAt: string) {
  const result = getDatabase()
    .prepare(
      `UPDATE auth_sessions
      SET revoked_at = CASE
        WHEN revoked_at IS NULL THEN ?
        ELSE revoked_at
      END
      WHERE user_id = ?`,
    )
    .run(revokedAt, userId);

  return result.changes;
}

export function clearAuthSessions() {
  getDatabase().prepare("DELETE FROM auth_sessions").run();
}
