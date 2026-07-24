import { getDatabase } from "./database.js";

export function runInImmediateTransaction<T>(operation: () => T): T {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");

  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
