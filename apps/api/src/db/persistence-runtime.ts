import type { DatabaseSync } from "node:sqlite";
import {
  closeDatabaseConnection,
  getDatabase,
} from "./database.js";
import {
  resolvePersistenceDriver,
  type PersistenceDriver,
} from "./persistence-driver.js";
import {
  createPostgresDatabase,
  type PostgresDatabase,
} from "./postgres/database.js";
import { PostgresDataPlane } from "./postgres/data-plane.js";
import {
  inspectPostgresMigrationState,
  runPostgresMigrations,
} from "./postgres/migrations.js";

export interface PersistenceReadiness {
  driver: PersistenceDriver;
  ready: boolean;
  details?: Record<string, unknown>;
  reason?: string;
}

export interface PersistenceRuntime {
  readonly driver: PersistenceDriver;
  close(): Promise<void>;
  initialize(): Promise<void>;
  metrics(): Record<string, unknown>;
  readiness(): Promise<PersistenceReadiness>;
}

export class PersistenceNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceNotReadyError";
  }
}

export class SqlitePersistenceRuntime implements PersistenceRuntime {
  readonly driver = "sqlite" as const;
  private database?: DatabaseSync;

  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  async initialize() {
    this.database ??= getDatabase(this.env);
  }

  async readiness(): Promise<PersistenceReadiness> {
    try {
      await this.initialize();
      this.database?.prepare("SELECT 1 AS ready").get();
      return {
        driver: this.driver,
        ready: true,
      };
    } catch {
      return {
        driver: this.driver,
        ready: false,
        reason: "sqlite_unavailable",
      };
    }
  }

  metrics() {
    return {
      driver: this.driver,
      mode: "local_or_test_only",
      open: Boolean(this.database),
    };
  }

  async close() {
    closeDatabaseConnection();
    this.database = undefined;
  }
}

export interface PostgresPersistenceRuntimeOptions {
  migrateOnStart?: boolean;
}

export class PostgresPersistenceRuntime implements PersistenceRuntime {
  readonly driver = "postgres" as const;
  private initializePromise?: Promise<void>;
  private closed = false;

  constructor(
    readonly database: PostgresDatabase,
    readonly dataPlane: PostgresDataPlane,
    private readonly options: PostgresPersistenceRuntimeOptions = {},
  ) {}

  initialize() {
    if (this.closed) {
      return Promise.reject(
        new PersistenceNotReadyError(
          "PostgreSQL persistence has already been closed.",
        ),
      );
    }

    this.initializePromise ??= this.initializeOnce();
    return this.initializePromise;
  }

  private async initializeOnce() {
    if (this.options.migrateOnStart) {
      await runPostgresMigrations(this.database.pool);
    }

    const migrationState = await inspectPostgresMigrationState(
      this.database.pool,
    );

    if (!migrationState.ready) {
      throw new PersistenceNotReadyError(
        `PostgreSQL schema is not ready: ${
          migrationState.reason ?? "unknown_migration_state"
        }.`,
      );
    }

    const databaseState = await this.database.readiness();

    if (!databaseState.ready) {
      throw new PersistenceNotReadyError(
        `PostgreSQL is unavailable: ${databaseState.errorCode}.`,
      );
    }
  }

  async readiness(): Promise<PersistenceReadiness> {
    if (this.closed) {
      return {
        driver: this.driver,
        ready: false,
        reason: "postgres_closed",
      };
    }

    try {
      const [databaseState, migrationState] = await Promise.all([
        this.database.readiness(),
        inspectPostgresMigrationState(this.database.pool),
      ]);

      return {
        details: {
          database: databaseState,
          migrations: migrationState,
        },
        driver: this.driver,
        ready: databaseState.ready && migrationState.ready,
        reason:
          !databaseState.ready
            ? "postgres_unavailable"
            : !migrationState.ready
              ? migrationState.reason
              : undefined,
      };
    } catch (error) {
      return {
        details: {
          errorName:
            error instanceof Error ? error.name : "UnknownPersistenceError",
        },
        driver: this.driver,
        ready: false,
        reason:
          error instanceof Error
            ? error.message
            : "postgres_readiness_failed",
      };
    }
  }

  metrics() {
    return {
      driver: this.driver,
      ...this.database.metrics.snapshot(this.database.pool),
    };
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.database.close();
  }
}

function parseMigrateOnStart(
  env: Record<string, string | undefined>,
) {
  const value = env.PERSISTENCE_MIGRATE_ON_START?.trim().toLowerCase();

  if (value === "true" || value === "1" || value === "yes") {
    return true;
  }

  if (value === "false" || value === "0" || value === "no") {
    return false;
  }

  return env.NODE_ENV !== "production";
}

export function createPersistenceRuntime(
  env: Record<string, string | undefined> = process.env,
): PersistenceRuntime {
  const driver = resolvePersistenceDriver(env);

  if (driver === "sqlite") {
    return new SqlitePersistenceRuntime(env);
  }

  const database = createPostgresDatabase(env);
  return new PostgresPersistenceRuntime(
    database,
    new PostgresDataPlane(database),
    {
      migrateOnStart: parseMigrateOnStart(env),
    },
  );
}

let singletonRuntimePromise: Promise<PersistenceRuntime> | undefined;

export function getPersistenceRuntime(
  env: Record<string, string | undefined> = process.env,
) {
  if (!singletonRuntimePromise) {
    const runtimePromise = (async () => {
      const runtime = createPersistenceRuntime(env);

      try {
        await runtime.initialize();
        return runtime;
      } catch (error) {
        await runtime.close();
        throw error;
      }
    })();
    singletonRuntimePromise = runtimePromise;
    void runtimePromise.catch(() => {
      if (singletonRuntimePromise === runtimePromise) {
        singletonRuntimePromise = undefined;
      }
    });
  }

  return singletonRuntimePromise;
}

export async function getPostgresDataPlane(
  env: Record<string, string | undefined> = process.env,
) {
  const runtime = await getPersistenceRuntime(env);

  if (!(runtime instanceof PostgresPersistenceRuntime)) {
    throw new PersistenceNotReadyError(
      "This feature requires PERSISTENCE_DRIVER=postgres.",
    );
  }

  return runtime.dataPlane;
}

export async function closePersistenceRuntime() {
  const runtimePromise = singletonRuntimePromise;
  singletonRuntimePromise = undefined;

  if (!runtimePromise) {
    return;
  }

  const runtime = await runtimePromise.catch(() => undefined);
  await runtime?.close();
}

export function createPersistenceLifecycleHooks(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    close: () => closePersistenceRuntime(),
    metrics: async () => {
      try {
        return (await getPersistenceRuntime(env)).metrics();
      } catch (error) {
        return {
          driver: resolvePersistenceDriver(env),
          initializationError:
            error instanceof Error
              ? error.name
              : "UnknownPersistenceError",
        };
      }
    },
    readiness: async (): Promise<PersistenceReadiness> => {
      try {
        return await (await getPersistenceRuntime(env)).readiness();
      } catch (error) {
        return {
          details: {
            errorName:
              error instanceof Error
                ? error.name
                : "UnknownPersistenceError",
          },
          driver: resolvePersistenceDriver(env),
          ready: false,
          reason: "persistence_initialization_failed",
        };
      }
    },
  };
}

export async function resetPersistenceRuntimeForTests() {
  await closePersistenceRuntime();
}
