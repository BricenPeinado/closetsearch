import { fileURLToPath } from "node:url";
import {
  createPostgresDatabase,
  PostgresDataPlane,
  runPostgresMigrations,
} from "../db/postgres/index.js";
import { createCoreWorkerHandlers } from "./core-handlers.js";
import { WorkerRuntime } from "./runtime.js";

function integerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return value;
}

export async function runWorkerProcess() {
  const database = createPostgresDatabase();
  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort(new Error("Signal received."));

  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  try {
    await runPostgresMigrations(database.pool);
    const dataPlane = new PostgresDataPlane(database);
    const runtime = new WorkerRuntime(
      dataPlane,
      createCoreWorkerHandlers(),
      {
        concurrency: integerEnv("WORKER_CONCURRENCY", 4, 1, 32),
        leaseDurationMs: integerEnv(
          "WORKER_LEASE_DURATION_MS",
          60_000,
          5_000,
          900_000,
        ),
        logger: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
        pollIntervalMs: integerEnv(
          "WORKER_POLL_INTERVAL_MS",
          2_000,
          100,
          60_000,
        ),
        workerId: process.env.WORKER_ID?.trim(),
      },
    );
    await runtime.runUntilStopped(shutdown.signal);
  } finally {
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
    await database.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runWorkerProcess().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "worker_fatal",
        error: error instanceof Error ? error.message : "Unknown worker error.",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
