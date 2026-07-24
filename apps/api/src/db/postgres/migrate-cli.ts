import { fileURLToPath } from "node:url";
import { createPostgresDatabase } from "./database.js";
import { runPostgresMigrations } from "./migrations.js";

export async function migratePostgres() {
  const database = createPostgresDatabase();

  try {
    const result = await runPostgresMigrations(database.pool);
    process.stdout.write(
      `${JSON.stringify({
        event: "postgres_migrations_complete",
        ...result,
      })}\n`,
    );
  } finally {
    await database.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void migratePostgres().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "postgres_migrations_failed",
        error:
          error instanceof Error ? error.message : "Unknown migration error.",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
