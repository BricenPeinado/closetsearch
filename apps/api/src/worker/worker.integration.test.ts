import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Clock } from "../db/postgres/types.js";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import type { ListingObservationInput } from "../db/postgres/model.js";
import { createProviderIngestionHandler, type ProviderIngestionSource } from "./ingestion.js";
import { WorkerRuntime } from "./runtime.js";
import { WorkerJobError, type WorkerJobHandler } from "./types.js";

function listing(
  sourceListingId: string,
  idempotencyKey: string,
  sourceUrl = `https://market.example/${sourceListingId}`,
): ListingObservationInput {
  const observedAt = new Date("2026-07-24T12:00:00.000Z");

  return {
    analyticsEligible: true,
    availability: "available",
    fetchedAt: observedAt,
    id: randomUUID(),
    idempotencyKey,
    images: [],
    listingType: "buy_now",
    marketStatus: "active",
    observedAt,
    originalPrice: {
      amountMinor: 12_500n,
      currency: "USD",
    },
    providerId: "fixture-provider",
    sourceListingId,
    sourceMarketplace: "Fixture Market",
    sourceUrl,
    title: `Listing ${sourceListingId}`,
  };
}

describe("separate worker runtime", () => {
  it("resumes a partially persisted ingestion page without duplication", async () => {
    const harness = await createPostgresTestHarness();
    let currentTime = new Date("2026-07-24T12:00:00.000Z");
    const clock: Clock = {
      now: () => new Date(currentTime),
    };
    let calls = 0;
    const resumableHandler: WorkerJobHandler = async ({ checkpoint, dataPlane }) => {
      calls += 1;
      await dataPlane.listings.upsertObservation(listing("listing-a", "event-a"));

      if (calls === 1) {
        throw new WorkerJobError(
          "Simulated crash after the first durable listing.",
          "simulated_crash",
        );
      }

      await dataPlane.listings.upsertObservation(listing("listing-b", "event-b"));
      const value = {
        processedListings: 2,
      };
      await checkpoint(value);
      return {
        checkpoint: value,
        nextRunAt: new Date(currentTime.getTime() + 3_600_000),
      };
    };
    const handlers = new Map([["provider.ingest", resumableHandler]]);
    const runtime = new WorkerRuntime(harness.dataPlane, handlers, {
      clock,
      concurrency: 1,
      leaseDurationMs: 5_000,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 100,
      workerId: "integration-worker",
    });

    try {
      await harness.dataPlane.jobs.enqueue({
        jobKey: "ingest-fixture-active",
        jobType: "provider.ingest",
        payload: {
          ingestionScope: "active",
          providerId: "fixture-provider",
          queryKey: "all",
          successIntervalSeconds: 3_600,
        },
        runAfter: currentTime,
        scheduleIntervalSeconds: 3_600,
      });

      expect(await runtime.runOnce()).toBe(1);
      expect(await harness.dataPlane.jobs.getByKey("ingest-fixture-active")).toMatchObject({
        status: "retry_wait",
      });

      currentTime = new Date(currentTime.getTime() + 101);
      expect(await runtime.runOnce()).toBe(1);
      const completedJob = await harness.dataPlane.jobs.getByKey("ingest-fixture-active");
      expect(completedJob?.lastErrorMessage).toBeUndefined();
      expect(completedJob).toMatchObject({
        checkpoint: expect.objectContaining({
          processedListings: 2,
        }),
        status: "queued",
      });
      const counts = await harness.database.query<{
        listings: string | number;
        observations: string | number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM listings) AS listings,
           (SELECT COUNT(*) FROM price_observations) AS observations`,
      );
      expect(Number(counts.rows[0].listings)).toBe(2);
      expect(Number(counts.rows[0].observations)).toBe(2);
      expect(calls).toBe(2);
    } finally {
      await harness.database.close();
    }
  });

  it("replays idempotent alert matching after a crash following persistence", async () => {
    const harness = await createPostgresTestHarness();
    let currentTime = new Date("2030-07-24T12:00:00.000Z");
    const clock: Clock = {
      now: () => new Date(currentTime),
    };
    const observation = {
      ...listing("alert-replay", "alert-replay-event"),
      fetchedAt: currentTime,
      observedAt: currentTime,
    };
    const source: ProviderIngestionSource = {
      providerId: "fixture-provider",
      async fetchPage() {
        return {
          listings: [observation],
        };
      },
    };
    const originalMatchListing = harness.dataPlane.alerts.matchListing.bind(
      harness.dataPlane.alerts,
    );
    const matchListing = vi
      .spyOn(harness.dataPlane.alerts, "matchListing")
      .mockImplementationOnce(async (listingId, matchedAt, providerAuthorized) => {
        await originalMatchListing(listingId, matchedAt, providerAuthorized);
        throw new Error("Simulated crash after durable alert matching.");
      })
      .mockImplementation(originalMatchListing);
    const handlers = new Map([
      ["provider.ingest", createProviderIngestionHandler([source], clock.now, () => true)],
    ]);
    const runtime = new WorkerRuntime(harness.dataPlane, handlers, {
      clock,
      concurrency: 1,
      leaseDurationMs: 5_000,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 100,
      workerId: "alert-replay-worker",
    });

    try {
      const user = await harness.dataPlane.requestStore.createUser({
        createdAt: currentTime,
        onboardingPreferences: {
          categories: [],
          favoriteBrands: [],
          priceRange: "any",
        },
        passwordHash: `scrypt$${"p".repeat(64)}`,
        preferredCurrency: "USD",
        username: "alert-replay-user",
      });
      await harness.dataPlane.requestStore.createWatchlist({
        enabled: true,
        label: "Fixture provider",
        source: "Fixture Market",
        userId: user.id,
      });
      await harness.dataPlane.jobs.enqueue({
        jobKey: "alert-replay-ingestion",
        jobType: "provider.ingest",
        payload: {
          ingestionScope: "active",
          providerId: "fixture-provider",
          queryKey: "all",
          successIntervalSeconds: 3_600,
        },
        runAfter: currentTime,
        scheduleIntervalSeconds: 3_600,
      });

      expect(await runtime.runOnce()).toBe(1);
      expect(await harness.dataPlane.jobs.getByKey("alert-replay-ingestion")).toMatchObject({
        status: "retry_wait",
      });

      currentTime = new Date(currentTime.getTime() + 101);
      expect(await runtime.runOnce()).toBe(1);
      const completedJob = await harness.dataPlane.jobs.getByKey("alert-replay-ingestion");
      expect(completedJob?.lastErrorMessage).toBeUndefined();
      expect(completedJob).toMatchObject({
        checkpoint: expect.objectContaining({
          processedListings: 1,
        }),
        status: "queued",
      });
      const counts = await harness.database.query<{
        deliveries: string | number;
        matches: string | number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM alert_matches) AS matches,
           (SELECT COUNT(*) FROM alert_deliveries) AS deliveries`,
      );
      expect(Number(counts.rows[0].matches)).toBe(1);
      expect(Number(counts.rows[0].deliveries)).toBe(1);
      expect(matchListing).toHaveBeenCalledTimes(2);
    } finally {
      await harness.database.close();
    }
  });
});
