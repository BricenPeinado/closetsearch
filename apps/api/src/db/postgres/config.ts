import type { PoolConfig } from "pg";

export interface PostgresRuntimeConfig {
  connectionString: string;
  applicationName: string;
  poolMax: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  statementTimeoutMs: number;
  queryTimeoutMs: number;
  transactionRetryLimit: number;
  ssl: PoolConfig["ssl"];
}

function parseBoundedInteger(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const rawValue = env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  return parsedValue;
}

function parseSsl(env: Record<string, string | undefined>): PoolConfig["ssl"] {
  const mode = env.POSTGRES_SSL_MODE?.trim().toLowerCase() ?? "prefer";

  if (mode === "disable") {
    if (env.NODE_ENV === "production" && env.POSTGRES_ALLOW_INSECURE !== "true") {
      throw new Error(
        "POSTGRES_SSL_MODE=disable is forbidden in production unless POSTGRES_ALLOW_INSECURE=true is explicitly set.",
      );
    }

    return false;
  }

  if (mode === "prefer" || mode === "require") {
    return {
      rejectUnauthorized: false,
    };
  }

  if (mode === "verify-full") {
    return {
      ca: env.POSTGRES_SSL_CA?.replace(/\\n/g, "\n"),
      rejectUnauthorized: true,
    };
  }

  throw new Error("POSTGRES_SSL_MODE must be one of disable, prefer, require, or verify-full.");
}

export function loadPostgresRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): PostgresRuntimeConfig {
  const connectionString = env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the PostgreSQL production data plane.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme.");
  }

  return {
    connectionString,
    applicationName: env.POSTGRES_APPLICATION_NAME?.trim() || "closetsearch-api",
    poolMax: parseBoundedInteger(env, "POSTGRES_POOL_MAX", 10, 1, 100),
    connectionTimeoutMs: parseBoundedInteger(
      env,
      "POSTGRES_CONNECTION_TIMEOUT_MS",
      5_000,
      100,
      120_000,
    ),
    idleTimeoutMs: parseBoundedInteger(env, "POSTGRES_IDLE_TIMEOUT_MS", 30_000, 1_000, 600_000),
    statementTimeoutMs: parseBoundedInteger(
      env,
      "POSTGRES_STATEMENT_TIMEOUT_MS",
      10_000,
      100,
      300_000,
    ),
    queryTimeoutMs: parseBoundedInteger(env, "POSTGRES_QUERY_TIMEOUT_MS", 12_000, 100, 300_000),
    transactionRetryLimit: parseBoundedInteger(env, "POSTGRES_TRANSACTION_RETRY_LIMIT", 3, 0, 10),
    ssl: parseSsl(env),
  };
}

export function toPoolConfig(config: PostgresRuntimeConfig): PoolConfig {
  return {
    application_name: config.applicationName,
    connectionString: config.connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    max: config.poolMax,
    query_timeout: config.queryTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    ssl: config.ssl,
  };
}
