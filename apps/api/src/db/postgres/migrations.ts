import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient, QueryResultRow } from "pg";
import type { PgPoolLike } from "./types.js";

export interface PostgresMigration {
  checksum: string;
  name: string;
  sql: string;
  version: number;
}

interface AppliedMigrationRow extends QueryResultRow {
  version: number;
  name: string;
  checksum: string;
}

const migrationFilePattern = /^(\d{3})_([a-z0-9_]+)\.sql$/;
const migrationNamespace = "closetsearch_postgres";
const advisoryLockKey = 718_847_752;

export class MigrationDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationDriftError";
  }
}

export function checksumMigration(sql: string) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function loadPostgresMigrations(
  directory = fileURLToPath(new URL("./migrations", import.meta.url)),
) {
  const migrations = readdirSync(directory)
    .filter((fileName) => migrationFilePattern.test(fileName))
    .map((fileName): PostgresMigration => {
      const match = migrationFilePattern.exec(fileName);

      if (!match) {
        throw new Error(`Invalid PostgreSQL migration filename: ${fileName}`);
      }

      const sql = readFileSync(resolve(directory, fileName), "utf8");

      return {
        checksum: checksumMigration(sql),
        name: basename(fileName, ".sql"),
        sql,
        version: Number(match[1]),
      };
    })
    .sort((left, right) => left.version - right.version);

  const versions = new Set<number>();

  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new MigrationDriftError(
        `Duplicate PostgreSQL migration version ${migration.version}.`,
      );
    }

    versions.add(migration.version);
  }

  return migrations;
}

async function ensureMigrationLedger(client: PoolClient) {
  const existing = await client.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'postgres_schema_migrations'
     LIMIT 1`,
  );

  if (existing.rowCount) {
    return;
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS postgres_schema_migrations (
      namespace TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, version),
      CHECK (version > 0),
      CHECK (char_length(checksum) = 64),
      CHECK (execution_ms >= 0)
    )
  `);
}

function verifyMigrationHistory(
  migrations: PostgresMigration[],
  appliedRows: AppliedMigrationRow[],
) {
  const localByVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );

  for (const applied of appliedRows) {
    const local = localByVersion.get(Number(applied.version));

    if (!local) {
      throw new MigrationDriftError(
        `Applied PostgreSQL migration ${applied.version} is missing locally.`,
      );
    }

    if (local.name !== applied.name) {
      throw new MigrationDriftError(
        `PostgreSQL migration ${applied.version} was renamed after it was applied.`,
      );
    }

    if (local.checksum !== applied.checksum) {
      throw new MigrationDriftError(
        `PostgreSQL migration ${applied.version} checksum differs from the applied migration.`,
      );
    }
  }

  const maximumAppliedVersion = appliedRows.reduce(
    (maximum, row) => Math.max(maximum, Number(row.version)),
    0,
  );
  const outOfOrder = migrations.find(
    (migration) =>
      migration.version < maximumAppliedVersion &&
      !appliedRows.some(
        (applied) => Number(applied.version) === migration.version,
      ),
  );

  if (outOfOrder) {
    throw new MigrationDriftError(
      `PostgreSQL migration ${outOfOrder.version} was inserted before already-applied migration ${maximumAppliedVersion}.`,
    );
  }
}

export interface RunPostgresMigrationsOptions {
  migrations?: PostgresMigration[];
  useAdvisoryLock?: boolean;
}

export async function runPostgresMigrations(
  pool: PgPoolLike,
  options: RunPostgresMigrationsOptions = {},
) {
  const migrations = options.migrations ?? loadPostgresMigrations();
  const client = await pool.connect();
  const useAdvisoryLock = options.useAdvisoryLock ?? true;
  const appliedNow: number[] = [];

  try {
    if (useAdvisoryLock) {
      await client.query("SELECT pg_advisory_lock($1::bigint)", [
        advisoryLockKey,
      ]);
    }

    await ensureMigrationLedger(client);
    const appliedResult = await client.query<AppliedMigrationRow>(
      `SELECT version, name, checksum
       FROM postgres_schema_migrations
       WHERE namespace = $1
       ORDER BY version`,
      [migrationNamespace],
    );

    verifyMigrationHistory(migrations, appliedResult.rows);
    const appliedVersions = new Set(
      appliedResult.rows.map((row) => Number(row.version)),
    );

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      const startedAt = performance.now();
      await client.query("BEGIN");

      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO postgres_schema_migrations (
             namespace,
             version,
             name,
             checksum,
             execution_ms
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            migrationNamespace,
            migration.version,
            migration.name,
            migration.checksum,
            Math.max(0, Math.round(performance.now() - startedAt)),
          ],
        );
        await client.query("COMMIT");
        appliedNow.push(migration.version);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return {
      applied: appliedNow,
      currentVersion:
        migrations.at(-1)?.version ?? 0,
    };
  } finally {
    if (useAdvisoryLock) {
      await client
        .query("SELECT pg_advisory_unlock($1::bigint)", [advisoryLockKey])
        .catch(() => undefined);
    }

    client.release();
  }
}
