import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  closeDatabaseConnection,
  resetDatabaseFileForTests,
  setDatabasePathForTests,
} from "./database.js";

export function createIsolatedDatabasePath(label: string) {
  const directory = mkdtempSync(join(tmpdir(), `closetsearch-${label}-`));
  return join(directory, "closetsearch.sqlite");
}

export function useIsolatedDatabase(label: string) {
  const databasePath = createIsolatedDatabasePath(label);
  setDatabasePathForTests(databasePath);
  resetDatabaseFileForTests();
  return databasePath;
}

export function cleanupIsolatedDatabase(databasePath: string) {
  closeDatabaseConnection();
  rmSync(dirname(databasePath), { force: true, recursive: true });
  setDatabasePathForTests();
}
