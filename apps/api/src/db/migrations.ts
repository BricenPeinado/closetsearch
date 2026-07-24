import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { logInfo } from "../logger.js";

interface MigrationDefinition {
  id: string;
  sql: string;
}

const migrationDefinitions: MigrationDefinition[] = [
  {
    id: "001_initial_persistence",
    sql: readFileSync(
      new URL("./schema/001_initial_persistence.sql", import.meta.url),
      "utf-8",
    ),
  },
  {
    id: "002_auth_sessions",
    sql: readFileSync(
      new URL("./schema/002_auth_sessions.sql", import.meta.url),
      "utf-8",
    ),
  },
  {
    id: "003_saved_user_features",
    sql: readFileSync(
      new URL("./schema/003_saved_user_features.sql", import.meta.url),
      "utf-8",
    ),
  },
  {
    id: "004_price_snapshots",
    sql: readFileSync(
      new URL("./schema/004_price_snapshots.sql", import.meta.url),
      "utf-8",
    ),
  },
  {
    id: "005_alert_watchlists",
    sql: readFileSync(
      new URL("./schema/005_alert_watchlists.sql", import.meta.url),
      "utf-8",
    ),
  },
  {
    id: "006_deterministic_price_observations",
    sql: readFileSync(
      new URL("./schema/006_deterministic_price_observations.sql", import.meta.url),
      "utf-8",
    ),
  },
];

function ensureMigrationTable(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

export function runMigrations(database: DatabaseSync) {
  ensureMigrationTable(database);

  const appliedMigrationIds = new Set(
    ((database.prepare("SELECT id FROM schema_migrations").all() as unknown as Array<{
      id: string;
    }>)).map((row) => row.id),
  );

  const appliedNow: string[] = [];

  for (const migration of migrationDefinitions) {
    if (appliedMigrationIds.has(migration.id)) {
      continue;
    }

    database.exec("BEGIN");

    try {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        )
        .run(migration.id, new Date().toISOString());
      database.exec("COMMIT");
      appliedNow.push(migration.id);
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return appliedNow;
}

async function runMigrationsCli() {
  const { closeDatabaseConnection, getDatabase, getDatabasePath } = await import(
    "./database.js"
  );

  const database = getDatabase();
  const appliedMigrations = runMigrations(database);

  logInfo("Migration command completed", {
    appliedMigrations,
    databasePath: getDatabasePath(),
    status: appliedMigrations.length > 0 ? "applied" : "no_pending_migrations",
  });

  closeDatabaseConnection();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runMigrationsCli();
}
