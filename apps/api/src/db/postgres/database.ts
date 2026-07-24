import { performance } from "node:perf_hooks";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { loadPostgresRuntimeConfig, toPoolConfig, type PostgresRuntimeConfig } from "./config.js";
import { DatabaseMetrics } from "./metrics.js";
import { withTransientPostgresRetry } from "./retry.js";
import type { PgPoolLike, PgQueryable } from "./types.js";

export interface TransactionOptions {
  isolationLevel?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
  retryLimit?: number;
  signal?: AbortSignal;
}

class InstrumentedQueryable implements PgQueryable {
  constructor(
    private readonly queryable: PgQueryable,
    private readonly metrics: DatabaseMetrics,
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) {
    const startedAt = performance.now();

    try {
      const result = await this.queryable.query<Row>(text, values);
      this.metrics.recordQuery(performance.now() - startedAt, true);
      return result;
    } catch (error) {
      this.metrics.recordQuery(performance.now() - startedAt, false);
      throw error;
    }
  }
}

export class PostgresDatabase implements PgQueryable {
  readonly metrics: DatabaseMetrics;

  constructor(
    readonly pool: PgPoolLike,
    readonly config: Pick<PostgresRuntimeConfig, "transactionRetryLimit"> = {
      transactionRetryLimit: 3,
    },
    metrics = new DatabaseMetrics(),
  ) {
    this.metrics = metrics;
  }

  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
    return new InstrumentedQueryable(this.pool, this.metrics).query<Row>(text, values);
  }

  async withTransaction<T>(
    operation: (client: PgQueryable) => Promise<T>,
    options: TransactionOptions = {},
  ) {
    const retryLimit = options.retryLimit ?? this.config.transactionRetryLimit;

    return withTransientPostgresRetry(
      async () => {
        const client = await this.pool.connect();
        const instrumentedClient = new InstrumentedQueryable(client, this.metrics);

        try {
          await instrumentedClient.query("BEGIN");
          if (options.isolationLevel) {
            await instrumentedClient.query(
              `SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`,
            );
          }
          const result = await operation(instrumentedClient);
          await instrumentedClient.query("COMMIT");
          this.metrics.recordTransactionCommitted();
          return result;
        } catch (error) {
          try {
            await instrumentedClient.query("ROLLBACK");
          } finally {
            this.metrics.recordTransactionRolledBack();
          }

          throw error;
        } finally {
          client.release();
        }
      },
      {
        attempts: retryLimit,
        signal: options.signal,
        onRetry: () => this.metrics.recordRetry(),
      },
    );
  }

  async readiness() {
    const startedAt = performance.now();

    try {
      const result = await this.query<{ database_time: Date }>(
        "SELECT CURRENT_TIMESTAMP AS database_time",
      );

      return {
        ready: true as const,
        latencyMs: performance.now() - startedAt,
        databaseTime: result.rows[0]?.database_time,
        pool: this.metrics.snapshot(this.pool).pool,
      };
    } catch (error) {
      return {
        ready: false as const,
        latencyMs: performance.now() - startedAt,
        errorCode:
          error &&
          typeof error === "object" &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : "database_unavailable",
        pool: this.metrics.snapshot(this.pool).pool,
      };
    }
  }

  close() {
    return this.pool.end();
  }
}

export function createPostgresDatabase(env: Record<string, string | undefined> = process.env) {
  const config = loadPostgresRuntimeConfig(env);
  const pool = new Pool(toPoolConfig(config));
  const database = new PostgresDatabase(pool, config);

  pool.on("error", () => {
    // The pg pool surfaces idle-client failures here. Callers consume only the
    // aggregate failure count; no connection string or secret is logged.
    database.metrics.recordPoolError();
  });

  return database;
}

export type PostgresTransactionClient = PoolClient;
