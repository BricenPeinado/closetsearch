import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PostgresDatabase } from "./database.js";
import {
  loadPostgresMigrations,
  MigrationDriftError,
  runPostgresMigrations,
} from "./migrations.js";
import type { ListingObservationInput } from "./model.js";
import { createPostgresTestHarness } from "./test-harness.js";

async function insertUser(
  database: Awaited<ReturnType<typeof createPostgresTestHarness>>["database"],
  userId = randomUUID(),
) {
  await database.query(
    `INSERT INTO users (
       id,
       username,
       normalized_username,
       password_hash
     ) VALUES ($1, $2, $2, $3)`,
    [userId, `user-${userId.slice(0, 8)}`, "scrypt$test"],
  );
  return userId;
}

function listingInput(input: {
  amountMinor: bigint;
  fetchedAt?: Date;
  idempotencyKey: string;
  images?: boolean;
  observedAt?: Date;
  sourceListingId?: string;
}): ListingObservationInput {
  const observedAt = input.observedAt ?? new Date("2026-07-24T12:00:00.000Z");

  return {
    analyticsEligible: true,
    availability: "available",
    category: "jackets",
    condition: "good",
    fetchedAt: input.fetchedAt ?? observedAt,
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    images:
      input.images === false
        ? []
        : [
            {
              url: "https://images.example/listing.jpg",
            },
          ],
    listingType: "buy_now",
    marketStatus: "active",
    observedAt,
    originalPrice: {
      amountMinor: input.amountMinor,
      currency: "USD",
    },
    providerBrand: "Kapital",
    providerId: "fixture-provider",
    sourceListingId: input.sourceListingId ?? "listing-1",
    sourceMarketplace: "Fixture Market",
    sourceUrl: "https://market.example/listing-1",
    title: "Kapital jacket",
  };
}

describe("PostgreSQL production data plane", () => {
  it("applies a clean schema, is idempotent, and rejects checksum drift", async () => {
    const harness = await createPostgresTestHarness();

    try {
      const secondRun = await runPostgresMigrations(harness.pool, {
        useAdvisoryLock: false,
      });
      expect(secondRun).toEqual({
        applied: [],
        currentVersion: 6,
      });

      const migrations = loadPostgresMigrations();
      const drifted = migrations.map((migration) =>
        migration.version === 2 ? { ...migration, checksum: "0".repeat(64) } : migration,
      );

      await expect(
        runPostgresMigrations(harness.pool, {
          migrations: drifted,
          useAdvisoryLock: false,
        }),
      ).rejects.toBeInstanceOf(MigrationDriftError);
    } finally {
      await harness.database.close();
    }
  });

  it("rolls back and never commits when transactional work fails", async () => {
    const statements: string[] = [];
    const fakeClient = {
      async query(text: string) {
        statements.push(text);
        return { command: "", fields: [], oid: 0, rowCount: 0, rows: [] };
      },
      release() {
        return undefined;
      },
    };
    const database = new PostgresDatabase(
      {
        connect: async () => fakeClient as never,
        end: async () => undefined,
        query: fakeClient.query,
      },
      { transactionRetryLimit: 0 },
    );

    await expect(
      database.withTransaction(async (client) => {
        await client.query("INSERT INTO durable_record VALUES (1)");
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");
    expect(statements).toEqual(["BEGIN", "INSERT INTO durable_record VALUES (1)", "ROLLBACK"]);
  });

  it("orders repeated same-timestamp price changes by a monotonic version", async () => {
    const harness = await createPostgresTestHarness();
    const observedAt = new Date("2026-07-24T12:00:00.000Z");

    try {
      await harness.dataPlane.listings.upsertObservation(
        listingInput({
          amountMinor: 18_000n,
          idempotencyKey: "event-1",
          observedAt,
        }),
      );
      await harness.dataPlane.listings.upsertObservation(
        listingInput({
          amountMinor: 14_000n,
          idempotencyKey: "event-2",
          observedAt,
        }),
      );
      await harness.dataPlane.listings.upsertObservation(
        listingInput({
          amountMinor: 18_000n,
          idempotencyKey: "event-3",
          observedAt,
        }),
      );

      const history = await harness.dataPlane.listings.latestPriceHistory(
        "fixture-provider",
        "listing-1",
      );

      expect(history.map((entry) => entry.originalPriceMinor)).toEqual([18_000n, 14_000n, 18_000n]);
      expect(history.map((entry) => entry.observationVersion)).toEqual([3n, 2n, 1n]);
    } finally {
      await harness.database.close();
    }
  });

  it("deduplicates ingestion events and concurrent listing upserts", async () => {
    const harness = await createPostgresTestHarness();

    try {
      const first = await harness.dataPlane.listings.upsertObservation(
        listingInput({
          amountMinor: 10_000n,
          idempotencyKey: "duplicate-event",
        }),
      );
      const duplicate = await harness.dataPlane.listings.upsertObservation(
        listingInput({
          amountMinor: 10_000n,
          idempotencyKey: "duplicate-event",
        }),
      );
      expect(first.result).toBe("inserted");
      expect(duplicate).toMatchObject({
        duplicate: true,
        listingId: first.listingId,
        result: "duplicate",
      });

      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          harness.dataPlane.listings.upsertObservation(
            listingInput({
              amountMinor: 10_000n,
              idempotencyKey: `concurrent-${index}`,
              images: false,
            }),
          ),
        ),
      );
      const listingCount = await harness.database.query<{
        count: string | number;
      }>(
        `SELECT COUNT(*) AS count
         FROM listings
         WHERE provider_id = 'fixture-provider'
           AND source_listing_id = 'listing-1'`,
      );
      expect(Number(listingCount.rows[0].count)).toBe(1);
    } finally {
      await harness.database.close();
    }
  });

  it("refreshes an unchanged listing without duplicating its price history", async () => {
    const harness = await createPostgresTestHarness();
    const firstSeenAt = new Date("2026-07-24T12:00:00.000Z");
    const seenAgainAt = new Date("2026-07-24T13:00:00.000Z");

    try {
      const first = await harness.dataPlane.listings.upsertObservation(
        listingInput({
          amountMinor: 10_000n,
          fetchedAt: firstSeenAt,
          idempotencyKey: "unchanged-listing:first-scan",
          observedAt: firstSeenAt,
          sourceListingId: "unchanged-listing",
        }),
      );
      const refreshed = await harness.dataPlane.listings.upsertObservation(
        listingInput({
          amountMinor: 10_000n,
          fetchedAt: seenAgainAt,
          idempotencyKey: "unchanged-listing:second-scan",
          observedAt: seenAgainAt,
          sourceListingId: "unchanged-listing",
        }),
      );
      const state = await harness.database.query<{
        availability: string;
        last_seen_at: Date;
      }>(
        `SELECT availability, last_seen_at
         FROM listing_current_state
         WHERE listing_id = $1`,
        [first.listingId],
      );
      const history = await harness.dataPlane.listings.latestPriceHistory(
        "fixture-provider",
        "unchanged-listing",
      );

      expect(refreshed).toMatchObject({
        duplicate: false,
        listingId: first.listingId,
        result: "updated",
      });
      expect(state.rows[0]).toMatchObject({
        availability: "available",
        last_seen_at: seenAgainAt,
      });
      expect(history).toHaveLength(1);
    } finally {
      await harness.database.close();
    }
  });

  it("persists across pool restarts and supports an engine backup restore", async () => {
    const harness = await createPostgresTestHarness();
    const userId = await insertUser(harness.database);
    const backup = harness.memory.backup();

    await harness.database.close();
    const restartedPool = new harness.adapter.Pool() as unknown as typeof harness.pool;

    try {
      const restartedResult = await restartedPool.query("SELECT id FROM users WHERE id = $1", [
        userId,
      ]);
      expect(restartedResult.rowCount).toBe(1);

      await restartedPool.query("DELETE FROM users WHERE id = $1", [userId]);
      backup.restore();
      const restoredResult = await restartedPool.query("SELECT id FROM users WHERE id = $1", [
        userId,
      ]);
      expect(restoredResult.rowCount).toBe(1);
    } finally {
      await restartedPool.end();
    }
  });

  it("deduplicates durable engagement and reads persisted entitlements", async () => {
    const harness = await createPostgresTestHarness();
    const userId = await insertUser(harness.database);
    const listing = await harness.dataPlane.listings.upsertObservation(
      listingInput({
        amountMinor: 20_000n,
        idempotencyKey: "engagement-listing",
      }),
    );
    const eventId = randomUUID();

    try {
      const event = {
        eventId,
        eventType: "listing_view" as const,
        listingId: listing.listingId,
        occurredAt: new Date("2026-07-24T12:00:00.000Z"),
        privacySessionHash: "a".repeat(64),
        userId,
        viewportDurationMs: 1_500,
      };
      expect(await harness.dataPlane.engagement.record(event)).toEqual({
        duplicate: false,
        recorded: true,
      });
      expect(await harness.dataPlane.engagement.record(event)).toEqual({
        duplicate: true,
        recorded: false,
      });
      await harness.dataPlane.engagement.rollupDay(event.occurredAt);
      const aggregate = await harness.dataPlane.engagement.getDailyAggregate(
        listing.listingId,
        event.occurredAt,
      );
      expect(aggregate).toMatchObject({
        uniqueSessionCount: 1n,
        viewCount: 1n,
      });
      await expect(
        harness.dataPlane.engagement.getUserListingScores(
          userId,
          new Date("2026-07-01T00:00:00.000Z"),
        ),
      ).resolves.toEqual(new Map([["fixture-provider:listing-1", 0.25]]));

      const entitlement = await harness.dataPlane.entitlements.grant({
        featureKey: "market_analytics",
        provider: "admin",
        startsAt: new Date("2026-07-24T00:00:00.000Z"),
        userId,
      });
      expect(
        await harness.dataPlane.entitlements.hasActive(
          userId,
          "market_analytics",
          new Date("2026-07-24T12:00:00.000Z"),
        ),
      ).toBe(true);
      await harness.dataPlane.entitlements.revoke(
        entitlement.id,
        new Date("2026-07-24T13:00:00.000Z"),
      );
      expect(
        await harness.dataPlane.entitlements.hasActive(
          userId,
          "market_analytics",
          new Date("2026-07-24T14:00:00.000Z"),
        ),
      ).toBe(false);
    } finally {
      await harness.database.close();
    }
  });

  it("allows only one worker to acquire a database-backed lease", async () => {
    const harness = await createPostgresTestHarness();
    const now = new Date("2026-07-24T12:00:00.000Z");

    try {
      await harness.dataPlane.jobs.enqueue({
        jobKey: "lease-contention",
        jobType: "test",
        runAfter: now,
      });
      const [left, right] = await Promise.all([
        harness.dataPlane.jobs.claimNext({
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          now,
          workerId: "worker-left",
        }),
        harness.dataPlane.jobs.claimNext({
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          now,
          workerId: "worker-right",
        }),
      ]);

      expect([left, right].filter(Boolean)).toHaveLength(1);
    } finally {
      await harness.database.close();
    }
  });

  it("lists operational checkpoint and provider health snapshots", async () => {
    const harness = await createPostgresTestHarness();
    const checkedAt = new Date("2026-07-24T12:00:00.000Z");
    const nextRunAt = new Date("2026-07-24T12:05:00.000Z");

    try {
      await harness.dataPlane.jobs.saveIngestionCheckpoint({
        consecutiveFailures: 2,
        continuationCursor: {
          cursor: "opaque-cursor",
        },
        expectedVersion: 0n,
        ingestionScope: "active",
        lastSuccessAt: checkedAt,
        nextRunAt,
        providerId: "ebay",
        queryKey: "active:default",
      });
      await harness.dataPlane.providers.recordHealth({
        checkedAt,
        latencyMs: 125,
        metadata: {
          source: "worker",
        },
        providerId: "ebay",
        state: "healthy",
      });

      await expect(harness.dataPlane.jobs.listIngestionCheckpoints()).resolves.toEqual([
        expect.objectContaining({
          consecutiveFailures: 2,
          continuationCursor: {
            cursor: "opaque-cursor",
          },
          ingestionScope: "active",
          lastSuccessAt: checkedAt,
          nextRunAt,
          providerId: "ebay",
          queryKey: "active:default",
          version: 1n,
        }),
      ]);
      await expect(harness.dataPlane.providers.listHealth()).resolves.toEqual([
        expect.objectContaining({
          consecutiveFailures: 0,
          lastCheckedAt: checkedAt,
          lastSuccessAt: checkedAt,
          latencyMs: 125,
          metadata: {
            source: "worker",
          },
          providerId: "ebay",
          state: "healthy",
        }),
      ]);
    } finally {
      await harness.database.close();
    }
  });
});
