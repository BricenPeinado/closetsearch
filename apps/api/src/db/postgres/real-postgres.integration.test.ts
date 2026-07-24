import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { hashPassword } from "../../auth/password-service.js";
import { PostgresDataPlane } from "./data-plane.js";
import { PostgresDatabase } from "./database.js";
import {
  inspectPostgresMigrationState,
  loadPostgresMigrations,
  runPostgresMigrations,
} from "./migrations.js";
import type { ListingObservationInput } from "./model.js";

const integrationUrl =
  process.env.POSTGRES_INTEGRATION_DATABASE_URL?.trim();
const describeRealPostgres = integrationUrl ? describe : describe.skip;

function databaseName(prefix: string) {
  return `${prefix}_${process.pid}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function assertDatabaseName(value: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("Generated PostgreSQL database name is invalid.");
  }

  return value;
}

function databaseUrl(baseUrl: string, name: string) {
  const url = new URL(baseUrl);
  url.pathname = `/${assertDatabaseName(name)}`;
  return url.toString();
}

async function createDatabase(admin: Pool, name: string) {
  await admin.query(`CREATE DATABASE "${assertDatabaseName(name)}"`);
}

async function dropDatabase(admin: Pool, name: string) {
  await admin.query(
    `DROP DATABASE IF EXISTS "${assertDatabaseName(name)}" WITH (FORCE)`,
  );
}

function observation(
  sourceListingId: string,
  idempotencyKey: string,
): ListingObservationInput {
  const observedAt = new Date("2026-07-24T12:00:00.000Z");

  return {
    analyticsEligible: true,
    availability: "available",
    fetchedAt: observedAt,
    id: "d8513f84-a3eb-4e57-a1f0-b09ca927e245",
    idempotencyKey,
    images: [
      {
        url: "https://images.example.com/real-postgres-listing.jpg",
      },
    ],
    listingType: "buy_now",
    marketStatus: "active",
    observedAt,
    originalPrice: {
      amountMinor: 12_500n,
      currency: "USD",
    },
    providerBrand: "Acme",
    providerId: "real-postgres-fixture",
    sourceListingId,
    sourceMarketplace: "Real PostgreSQL Fixture",
    sourceUrl: `https://market.example.com/${sourceListingId}`,
    title: "Real PostgreSQL concurrency fixture",
  };
}

describeRealPostgres("real PostgreSQL reliability", () => {
  let admin: Pool;
  let dataPlane: PostgresDataPlane;
  let database: PostgresDatabase;
  let testDatabaseName: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: integrationUrl });
    testDatabaseName = databaseName("closetsearch_real_it");
    await createDatabase(admin, testDatabaseName);
    const pool = new Pool({
      connectionString: databaseUrl(
        integrationUrl as string,
        testDatabaseName,
      ),
      max: 8,
    });
    await runPostgresMigrations(pool);
    database = new PostgresDatabase(pool, {
      transactionRetryLimit: 3,
    });
    dataPlane = new PostgresDataPlane(database, {
      jobs: { supportsSkipLocked: true },
      requestStore: {
        ipHintPepper: "real-postgres-integration-ip-pepper",
        nodeEnv: "test",
      },
    });
  }, 30_000);

  afterAll(async () => {
    await database?.close();

    if (admin && testDatabaseName) {
      await dropDatabase(admin, testDatabaseName);
    }

    await admin?.end();
  }, 30_000);

  it("upgrades every supported prior PostgreSQL schema without drift", async () => {
    const migrations = loadPostgresMigrations();

    for (let priorVersion = 1; priorVersion < migrations.length; priorVersion += 1) {
      const upgradeDatabaseName = databaseName(
        `closetsearch_upgrade_${priorVersion}`,
      );
      await createDatabase(admin, upgradeDatabaseName);
      const pool = new Pool({
        connectionString: databaseUrl(
          integrationUrl as string,
          upgradeDatabaseName,
        ),
      });

      try {
        await runPostgresMigrations(pool, {
          migrations: migrations.slice(0, priorVersion),
        });
        const upgraded = await runPostgresMigrations(pool);
        const state = await inspectPostgresMigrationState(pool);

        expect(upgraded.currentVersion).toBe(migrations.length);
        expect(state).toMatchObject({
          expectedVersion: migrations.length,
          pendingVersions: [],
          ready: true,
        });
      } finally {
        await pool.end();
        await dropDatabase(admin, upgradeDatabaseName);
      }
    }
  }, 60_000);

  it("serializes concurrent idempotent listing upserts", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        dataPlane.listings.upsertObservation(
          observation("shared-listing", `concurrent-event-${index}`),
        ),
      ),
    );
    const counts = await database.query<{
      listings: string;
      observations: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM listings
          WHERE provider_id = 'real-postgres-fixture'
            AND source_listing_id = 'shared-listing') AS listings,
         (SELECT COUNT(*) FROM price_observations po
          JOIN listings l ON l.id = po.listing_id
          WHERE l.provider_id = 'real-postgres-fixture'
            AND l.source_listing_id = 'shared-listing') AS observations`,
    );

    expect(results).toHaveLength(8);
    expect(Number(counts.rows[0]?.listings)).toBe(1);
    expect(Number(counts.rows[0]?.observations)).toBe(1);
  }, 30_000);

  it("rolls back multi-table request-store transactions", async () => {
    const username = `rollback-${randomUUID().slice(0, 8)}`;

    await expect(
      dataPlane.requestStore.withTransaction(async (store) => {
        await store.createUser({
          passwordHash: hashPassword("violet sparrow orbit lantern"),
          username,
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");
    await expect(
      dataPlane.requestStore.findUserCredentialsByNormalizedUsername(
        username,
      ),
    ).resolves.toBeUndefined();
  });

  it("allows only one worker to claim a leased job", async () => {
    await dataPlane.jobs.enqueue({
      jobKey: `lease-contention-${randomUUID()}`,
      jobType: "fixture",
      payload: {},
      runAfter: new Date("2026-07-24T12:00:00.000Z"),
    });
    const now = new Date("2026-07-24T12:00:00.000Z");
    const claimed = await Promise.all([
      dataPlane.jobs.claimNext({
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        now,
        workerId: "worker-a",
      }),
      dataPlane.jobs.claimNext({
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        now,
        workerId: "worker-b",
      }),
    ]);

    expect(claimed.filter(Boolean)).toHaveLength(1);
  });

  it("persists session revocation without storing raw token or IP values", async () => {
    const user = await dataPlane.requestStore.createUser({
      passwordHash: hashPassword("violet sparrow orbit lantern"),
      username: `session-${randomUUID().slice(0, 8)}`,
    });
    const rawToken = `raw-${randomUUID()}`;
    const rawIp = "198.51.100.27";
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await dataPlane.requestStore.createAuthSession({
      expiresAt: new Date(Date.now() + 60_000),
      ipHint: rawIp,
      sessionTokenHash: tokenHash,
      userId: user.id,
    });
    expect(
      await dataPlane.requestStore.revokeAuthSessionByTokenHash(tokenHash),
    ).toBe(true);
    const persisted = await database.query<{
      ip_hint_hash: string;
      revoked_at: Date;
      session_token_hash: string;
    }>(
      `SELECT session_token_hash, ip_hint_hash, revoked_at
       FROM auth_sessions
       WHERE user_id = $1`,
      [user.id],
    );

    expect(persisted.rows[0]?.session_token_hash).toBe(tokenHash);
    expect(persisted.rows[0]?.session_token_hash).not.toContain(rawToken);
    expect(persisted.rows[0]?.ip_hint_hash).not.toContain(rawIp);
    expect(persisted.rows[0]?.revoked_at).toBeInstanceOf(Date);
  });
});
