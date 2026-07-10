import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";

const defaultDatabasePath = fileURLToPath(
  new URL("../../.data/closetsearch.sqlite", import.meta.url),
);

let database: DatabaseSync | undefined;
let openDatabasePath: string | undefined;
let databasePathOverride: string | undefined;

function normalizeDatabasePath(databasePath: string) {
  return databasePath === ":memory:" ? databasePath : resolve(databasePath);
}

function ensureDatabaseDirectory(databasePath: string) {
  if (databasePath === ":memory:") {
    return;
  }

  mkdirSync(dirname(databasePath), { recursive: true });
}

export function getDatabasePath(env: Record<string, string | undefined> = process.env) {
  return normalizeDatabasePath(
    databasePathOverride ?? env.CLOSETSEARCH_DB_PATH?.trim() ?? defaultDatabasePath,
  );
}

export function closeDatabaseConnection() {
  database?.close();
  database = undefined;
  openDatabasePath = undefined;
}

export function getDatabase(env: Record<string, string | undefined> = process.env) {
  const databasePath = getDatabasePath(env);

  if (database && openDatabasePath === databasePath) {
    return database;
  }

  closeDatabaseConnection();
  ensureDatabaseDirectory(databasePath);

  const nextDatabase = new DatabaseSync(databasePath);
  nextDatabase.exec("PRAGMA foreign_keys = ON;");
  runMigrations(nextDatabase);

  database = nextDatabase;
  openDatabasePath = databasePath;

  return nextDatabase;
}

export function setDatabasePathForTests(databasePath?: string) {
  databasePathOverride = databasePath ? normalizeDatabasePath(databasePath) : undefined;
  closeDatabaseConnection();
}

export function resetDatabaseFileForTests() {
  const databasePath = getDatabasePath();

  closeDatabaseConnection();

  if (databasePath !== ":memory:") {
    rmSync(databasePath, { force: true });
  }
}
