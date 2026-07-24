import type { QueryResultRow } from "pg";
import type { PostgresDatabase } from "../database.js";

export type ProviderHealthState = "blocked" | "degraded" | "disabled" | "healthy" | "unavailable";

interface ProviderHealthRow extends QueryResultRow {
  provider_id: string;
  health_state: ProviderHealthState;
  last_checked_at: Date | string;
  last_success_at: Date | string | null;
  latency_ms: number | null;
  consecutive_failures: number;
  last_error_code: string | null;
  rate_limited_until: Date | string | null;
  circuit_open_until: Date | string | null;
  metadata: Record<string, unknown> | string;
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function mapProviderHealth(row: ProviderHealthRow) {
  return {
    circuitOpenUntil: row.circuit_open_until ? toDate(row.circuit_open_until) : undefined,
    consecutiveFailures: Number(row.consecutive_failures),
    errorCode: row.last_error_code ?? undefined,
    lastCheckedAt: toDate(row.last_checked_at),
    lastSuccessAt: row.last_success_at ? toDate(row.last_success_at) : undefined,
    latencyMs: row.latency_ms ?? undefined,
    metadata:
      typeof row.metadata === "string"
        ? (JSON.parse(row.metadata) as Record<string, unknown>)
        : row.metadata,
    providerId: row.provider_id,
    rateLimitedUntil: row.rate_limited_until ? toDate(row.rate_limited_until) : undefined,
    state: row.health_state,
  };
}

export class ProviderRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async recordHealth(input: {
    checkedAt: Date;
    circuitOpenUntil?: Date;
    errorCode?: string;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
    providerId: string;
    rateLimitedUntil?: Date;
    state: ProviderHealthState;
  }) {
    const succeeded = input.state === "healthy";
    await this.database.query(
      `INSERT INTO provider_health (
         provider_id,
         health_state,
         last_checked_at,
         last_success_at,
         latency_ms,
         consecutive_failures,
         last_error_code,
         rate_limited_until,
         circuit_open_until,
         metadata
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb
       )
       ON CONFLICT (provider_id) DO UPDATE SET
         health_state = EXCLUDED.health_state,
         last_checked_at = EXCLUDED.last_checked_at,
         last_success_at = CASE
           WHEN EXCLUDED.health_state = 'healthy'
             THEN EXCLUDED.last_checked_at
           ELSE provider_health.last_success_at
         END,
         latency_ms = EXCLUDED.latency_ms,
         consecutive_failures = CASE
           WHEN EXCLUDED.health_state = 'healthy' THEN 0
           ELSE provider_health.consecutive_failures + 1
         END,
         last_error_code = EXCLUDED.last_error_code,
         rate_limited_until = EXCLUDED.rate_limited_until,
         circuit_open_until = EXCLUDED.circuit_open_until,
         metadata = EXCLUDED.metadata`,
      [
        input.providerId,
        input.state,
        input.checkedAt,
        succeeded ? input.checkedAt : null,
        input.latencyMs ?? null,
        succeeded ? 0 : 1,
        input.errorCode ?? null,
        input.rateLimitedUntil ?? null,
        input.circuitOpenUntil ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async getHealth(providerId: string) {
    const result = await this.database.query<ProviderHealthRow>(
      `SELECT
         provider_id,
         health_state,
         last_checked_at,
         last_success_at,
         latency_ms,
         consecutive_failures,
         last_error_code,
         rate_limited_until,
         circuit_open_until,
         metadata
       FROM provider_health
       WHERE provider_id = $1`,
      [providerId],
    );
    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    return mapProviderHealth(row);
  }

  async listHealth() {
    const result = await this.database.query<ProviderHealthRow>(
      `SELECT
         provider_id,
         health_state,
         last_checked_at,
         last_success_at,
         latency_ms,
         consecutive_failures,
         last_error_code,
         rate_limited_until,
         circuit_open_until,
         metadata
       FROM provider_health
       ORDER BY provider_id`,
    );

    return result.rows.map(mapProviderHealth);
  }
}
