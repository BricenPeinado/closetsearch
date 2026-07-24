import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { PostgresDatabase } from "../database.js";
import type { PgQueryable } from "../types.js";

export type EntitlementProvider =
  | "admin"
  | "migration"
  | "promotion"
  | "subscription";

interface EntitlementRow extends QueryResultRow {
  id: string;
  user_id: string;
  feature_key: string;
  entitlement_provider: EntitlementProvider;
  external_reference: string | null;
  starts_at: Date | string;
  ends_at: Date | string | null;
  revoked_at: Date | string | null;
  metadata: Record<string, unknown> | string;
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function mapEntitlement(row: EntitlementRow) {
  return {
    endsAt: row.ends_at ? toDate(row.ends_at) : undefined,
    externalReference: row.external_reference || undefined,
    featureKey: row.feature_key,
    id: row.id,
    metadata:
      typeof row.metadata === "string"
        ? (JSON.parse(row.metadata) as Record<string, unknown>)
        : row.metadata,
    provider: row.entitlement_provider,
    revokedAt: row.revoked_at ? toDate(row.revoked_at) : undefined,
    startsAt: toDate(row.starts_at),
    userId: row.user_id,
  };
}

export class EntitlementRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async grant(
    input: {
      endsAt?: Date;
      externalReference?: string;
      featureKey: string;
      id?: string;
      metadata?: Record<string, unknown>;
      provider: EntitlementProvider;
      startsAt: Date;
      userId: string;
    },
    queryable: PgQueryable = this.database,
  ) {
    const result = await queryable.query<EntitlementRow>(
      `INSERT INTO premium_entitlements (
         id,
         user_id,
         feature_key,
         entitlement_provider,
         external_reference,
         starts_at,
         ends_at,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (
         user_id,
         feature_key,
         entitlement_provider,
         external_reference
       ) DO UPDATE SET
         starts_at = EXCLUDED.starts_at,
         ends_at = EXCLUDED.ends_at,
         revoked_at = NULL,
         metadata = EXCLUDED.metadata,
         updated_at = CURRENT_TIMESTAMP
       RETURNING
         id,
         user_id,
         feature_key,
         entitlement_provider,
         external_reference,
         starts_at,
         ends_at,
         revoked_at,
         metadata`,
      [
        input.id ?? randomUUID(),
        input.userId,
        input.featureKey,
        input.provider,
        input.externalReference ?? "",
        input.startsAt,
        input.endsAt ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    return mapEntitlement(result.rows[0]);
  }

  async revoke(id: string, revokedAt: Date) {
    const result = await this.database.query(
      `UPDATE premium_entitlements
       SET revoked_at = COALESCE(revoked_at, $2),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id, revokedAt],
    );

    return result.rowCount === 1;
  }

  async hasActive(userId: string, featureKey: string, at = new Date()) {
    const result = await this.database.query(
      `SELECT 1
       FROM premium_entitlements
       WHERE user_id = $1
         AND feature_key = $2
         AND starts_at <= $3
         AND (ends_at IS NULL OR ends_at > $3)
         AND revoked_at IS NULL
       LIMIT 1`,
      [userId, featureKey, at],
    );

    return result.rowCount === 1;
  }

  async listActive(userId: string, at = new Date()) {
    const result = await this.database.query<EntitlementRow>(
      `SELECT
         id,
         user_id,
         feature_key,
         entitlement_provider,
         external_reference,
         starts_at,
         ends_at,
         revoked_at,
         metadata
       FROM premium_entitlements
       WHERE user_id = $1
         AND starts_at <= $2
         AND (ends_at IS NULL OR ends_at > $2)
         AND revoked_at IS NULL
       ORDER BY starts_at DESC, id`,
      [userId, at],
    );

    return result.rows.map(mapEntitlement);
  }
}
