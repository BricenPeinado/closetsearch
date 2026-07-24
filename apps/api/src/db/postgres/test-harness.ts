import { DataType, newDb, type IMemoryDb } from "pg-mem";
import { PostgresDataPlane } from "./data-plane.js";
import { PostgresDatabase } from "./database.js";
import { runPostgresMigrations } from "./migrations.js";
import type { PgPoolLike } from "./types.js";

function registerPostgresCompatibilityFunctions(memory: IMemoryDb) {
  memory.public.registerFunction({
    args: [DataType.text],
    implementation: (value: string) => value.length,
    name: "char_length",
    returns: DataType.integer,
  });
  memory.public.registerFunction({
    args: [DataType.text],
    implementation: (value: string) => value.trim(),
    name: "btrim",
    returns: DataType.text,
  });
  memory.public.registerFunction({
    args: [DataType.jsonb],
    implementation: (value: unknown) => {
      if (Array.isArray(value)) {
        return "array";
      }

      if (value === null) {
        return "null";
      }

      return typeof value;
    },
    name: "jsonb_typeof",
    returns: DataType.text,
  });
  memory.public.registerOperator({
    implementation: (value: string, pattern: string) => new RegExp(pattern).test(value),
    left: DataType.text,
    operator: "~",
    returns: DataType.bool,
    right: DataType.text,
  });
  memory.public.registerFunction({
    args: [DataType.timestamptz, DataType.timestamptz],
    implementation: (left: Date, right: Date) => (left.getTime() >= right.getTime() ? left : right),
    name: "greatest",
    returns: DataType.timestamptz,
  });
}

export async function createPostgresTestHarness(memory = newDb()) {
  registerPostgresCompatibilityFunctions(memory);
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool() as unknown as PgPoolLike;
  await runPostgresMigrations(pool, {
    useAdvisoryLock: false,
  });
  const database = new PostgresDatabase(pool, {
    transactionRetryLimit: 0,
  });
  const dataPlane = new PostgresDataPlane(database, {
    jobs: {
      supportsSkipLocked: false,
    },
    listings: {
      useAdvisoryLocks: false,
    },
  });

  return {
    adapter,
    dataPlane,
    database,
    memory,
    pool,
  };
}
