import { afterEach, describe, expect, it } from "vitest";
import {
  createPersistenceLifecycleHooks,
  getPersistenceRuntime,
  PostgresPersistenceRuntime,
  resetPersistenceRuntimeForTests,
  SqlitePersistenceRuntime,
} from "./persistence-runtime.js";
import { resolvePersistenceDriver } from "./persistence-driver.js";
import { createPostgresTestHarness } from "./postgres/test-harness.js";

describe("persistence runtime lifecycle", () => {
  afterEach(async () => {
    await resetPersistenceRuntimeForTests();
  });

  it("requires an explicit driver except for the test-only SQLite default", () => {
    expect(resolvePersistenceDriver({ NODE_ENV: "test" })).toBe("sqlite");
    expect(
      resolvePersistenceDriver({
        NODE_ENV: "development",
        PERSISTENCE_DRIVER: "sqlite",
      }),
    ).toBe("sqlite");
    expect(() =>
      resolvePersistenceDriver({
        NODE_ENV: "development",
      }),
    ).toThrowError("explicitly set");
    expect(() =>
      resolvePersistenceDriver({
        NODE_ENV: "production",
        PERSISTENCE_DRIVER: "sqlite",
      }),
    ).toThrowError("forbidden in production");
  });

  it("reports migration-aware PostgreSQL readiness and closes idempotently", async () => {
    const harness = await createPostgresTestHarness();
    const runtime = new PostgresPersistenceRuntime(harness.database, harness.dataPlane, {
      migrateOnStart: false,
    });

    await runtime.initialize();
    await expect(runtime.readiness()).resolves.toMatchObject({
      driver: "postgres",
      ready: true,
    });
    expect(runtime.metrics()).toMatchObject({
      driver: "postgres",
      pool: expect.any(Object),
    });

    await runtime.close();
    await runtime.close();
    await expect(runtime.readiness()).resolves.toEqual({
      driver: "postgres",
      ready: false,
      reason: "postgres_closed",
    });
  });

  it("keeps SQLite explicitly labeled local/test only", () => {
    const runtime = new SqlitePersistenceRuntime({
      CLOSETSEARCH_DB_PATH: ":memory:",
      NODE_ENV: "test",
      PERSISTENCE_DRIVER: "sqlite",
    });

    expect(runtime.metrics()).toEqual({
      driver: "sqlite",
      mode: "local_or_test_only",
      open: false,
    });
  });

  it("initializes a singleton lazily and exposes graceful lifecycle hooks", async () => {
    const env = {
      CLOSETSEARCH_DB_PATH: ":memory:",
      NODE_ENV: "test",
      PERSISTENCE_DRIVER: "sqlite",
    };
    const first = getPersistenceRuntime(env);
    const second = getPersistenceRuntime(env);

    expect(first).toBe(second);
    await expect(first).resolves.toBeInstanceOf(SqlitePersistenceRuntime);

    const hooks = createPersistenceLifecycleHooks(env);
    await expect(hooks.readiness()).resolves.toEqual({
      driver: "sqlite",
      ready: true,
    });
    await expect(hooks.metrics()).resolves.toMatchObject({
      driver: "sqlite",
      mode: "local_or_test_only",
      open: true,
    });

    await hooks.close();
  });
});
