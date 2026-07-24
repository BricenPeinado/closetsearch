import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrations.js";

const priorMigrationIds = [
  "001_initial_persistence",
  "002_auth_sessions",
  "003_saved_user_features",
  "004_price_snapshots",
  "005_alert_watchlists",
  "006_deterministic_price_observations",
];

describe("account security migration", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("upgrades the prior SQLite schema without replacing existing users", () => {
    database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec(`
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    for (const migrationId of priorMigrationIds) {
      const migrationSql = readFileSync(
        new URL(`./schema/${migrationId}.sql`, import.meta.url),
        "utf-8",
      );
      database.exec(migrationSql);
      database
        .prepare(
          "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        )
        .run(migrationId, "2026-07-24T11:00:00.000Z");
    }

    database
      .prepare(
        `INSERT INTO users (
          id,
          username,
          normalized_username,
          password_hash,
          currency_preference,
          onboarding_preferences_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "existing-user",
        "ExistingUser",
        "existinguser",
        "legacy-password-hash",
        "USD",
        '{"favoriteBrands":[],"categories":[],"priceRange":""}',
        "2026-07-24T11:00:00.000Z",
      );

    expect(runMigrations(database)).toEqual(["007_account_security"]);
    expect(
      database
        .prepare("SELECT username FROM users WHERE id = ?")
        .get("existing-user"),
    ).toEqual({
      username: "ExistingUser",
    });
    expect(
      database
        .prepare(
          `SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name IN ('user_email_identities', 'account_tokens')
          ORDER BY name`,
        )
        .all(),
    ).toEqual([
      {
        name: "account_tokens",
      },
      {
        name: "user_email_identities",
      },
    ]);
    expect(runMigrations(database)).toEqual([]);
  });
});
