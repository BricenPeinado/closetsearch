import { describe, expect, it } from "vitest";
import type { Clock } from "../db/postgres/types.js";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import { createProviderIngestionHandler } from "./ingestion.js";
import { WorkerRuntime } from "./runtime.js";
import { WorkerJobError } from "./types.js";

describe("provider ingestion failure state", () => {
  it("persists retry metadata in the checkpoint and provider health", async () => {
    const harness = await createPostgresTestHarness();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const clock: Clock = {
      now: () => new Date(now),
    };
    const handler = createProviderIngestionHandler(
      [
        {
          providerId: "rate-limited-provider",
          async fetchPage() {
            throw new WorkerJobError(
              "Provider asked the worker to slow down.",
              "provider_rate_limited",
              false,
              120_000,
            );
          },
        },
      ],
      clock.now,
    );
    const runtime = new WorkerRuntime(harness.dataPlane, new Map([["provider.ingest", handler]]), {
      clock,
      concurrency: 1,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 300_000,
      workerId: "failure-test-worker",
    });

    try {
      await harness.dataPlane.jobs.enqueue({
        jobKey: "rate-limited-ingestion",
        jobType: "provider.ingest",
        payload: {
          ingestionScope: "active",
          providerId: "rate-limited-provider",
          queryKey: "active:default",
        },
        runAfter: now,
      });

      expect(await runtime.runOnce()).toBe(1);
      expect(
        await harness.dataPlane.jobs.getIngestionCheckpoint(
          "rate-limited-provider",
          "active",
          "active:default",
        ),
      ).toMatchObject({
        consecutiveFailures: 1,
        lastErrorCode: "provider_rate_limited",
        lastErrorMessage: "Provider asked the worker to slow down.",
        nextRunAt: new Date("2026-07-24T12:02:00.000Z"),
      });
      expect(await harness.dataPlane.jobs.getByKey("rate-limited-ingestion")).toMatchObject({
        runAfter: new Date("2026-07-24T12:02:00.000Z"),
        status: "retry_wait",
      });
      expect(await harness.dataPlane.providers.getHealth("rate-limited-provider")).toMatchObject({
        errorCode: "provider_rate_limited",
        rateLimitedUntil: new Date("2026-07-24T12:02:00.000Z"),
        state: "degraded",
      });
    } finally {
      await harness.database.close();
    }
  });
});
