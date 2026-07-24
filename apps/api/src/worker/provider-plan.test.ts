import type { Provider } from "@closetsearch/providers";
import { describe, expect, it } from "vitest";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import type { ProviderRuntime } from "../providers/registry.js";
import {
  createWorkerProviderPlan,
  seedWorkerJobs,
} from "./provider-plan.js";

function runtimeWithProviders(providers: Provider[]): ProviderRuntime {
  return {
    activeProviders: providers.map((provider) => ({
      mode: provider.isMock ? "mock" : "real",
      name: provider.name,
      provider,
    })),
    config: {
      allowMockFallback: false,
      maxProvidersPerRequest: 5,
      mode: "real",
      providers: {
        ebay: {
          configured: true,
          enabled: true,
        },
        grailed: {
          configured: false,
          enabled: false,
        },
        mock: {
          configured: true,
          enabled: false,
        },
      },
      requestTimeoutMs: 10_000,
    },
    preflightFailures: [],
    statuses: [],
  };
}

describe("worker provider plan", () => {
  it("schedules supported real scopes and never ingests mock inventory", () => {
    const plan = createWorkerProviderPlan(
      runtimeWithProviders([
        {
          capabilities: {
            dataOrigin: "official_api",
            supportsActiveListings: true,
            supportsSoldListings: false,
          },
          dataOrigin: "official_api",
          id: "official",
          name: "Official",
          async search() {
            return {
              listings: [],
              providerId: "official",
              status: "success",
            };
          },
        },
        {
          capabilities: {
            dataOrigin: "mock",
            supportsActiveListings: true,
            supportsSoldListings: true,
          },
          dataOrigin: "mock",
          id: "mock",
          isMock: true,
          name: "Mock",
          async search() {
            return {
              listings: [],
              providerId: "mock",
              status: "success",
            };
          },
        },
      ]),
      {
        WORKER_DEFAULT_INGESTION_QUERY: "archive jacket",
      },
    );

    expect(plan.sources.map((source) => source.providerId)).toEqual([
      "official",
    ]);
    expect(plan.jobs).toEqual([
      expect.objectContaining({
        jobKey: "provider.ingest:official:active:default",
        payload: expect.objectContaining({
          ingestionScope: "active",
          providerId: "official",
        }),
      }),
    ]);
  });

  it("supports validated configured searches and fails closed on bad JSON", () => {
    const runtime = runtimeWithProviders([
      {
        capabilities: {
          dataOrigin: "partner_api",
          supportsActiveListings: true,
          supportsSoldListings: true,
        },
        dataOrigin: "partner_api",
        id: "partner",
        name: "Partner",
        async search() {
          return {
            listings: [],
            providerId: "partner",
            status: "success",
          };
        },
      },
    ]);
    const plan = createWorkerProviderPlan(runtime, {
      WORKER_INGESTION_SEARCHES_JSON: JSON.stringify([
        {
          intervalSeconds: 600,
          key: "jackets",
          pageSize: 25,
          scope: "active",
          text: "archive jacket",
        },
        {
          intervalSeconds: 3_600,
          key: "comps",
          scope: "sold",
          text: "archive jacket",
        },
      ]),
    });

    expect(plan.jobs.map((job) => job.jobKey)).toEqual([
      "provider.ingest:partner:active:jackets",
      "provider.ingest:partner:sold:comps",
    ]);
    expect(() =>
      createWorkerProviderPlan(runtime, {
        WORKER_INGESTION_SEARCHES_JSON: "{not-json",
      }),
    ).toThrow("must be valid JSON");
  });

  it("seeds core and provider schedules idempotently without stealing leases", async () => {
    const harness = await createPostgresTestHarness();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const plan = {
      jobs: [
        {
          intervalSeconds: 900,
          jobKey: "provider.ingest:official:active:default",
          payload: {
            ingestionScope: "active" as const,
            providerId: "official",
            queryKey: "active:default",
            successIntervalSeconds: 900,
          },
        },
      ],
      sources: [],
    };

    try {
      await seedWorkerJobs(harness.dataPlane, plan, now);
      const claimed = await harness.dataPlane.jobs.claimNext({
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        now,
        workerId: "first-worker",
      });

      expect(claimed?.status).toBe("running");
      await seedWorkerJobs(harness.dataPlane, plan, now);
      expect(
        await harness.dataPlane.jobs.getByKey(claimed?.jobKey ?? ""),
      ).toMatchObject({
        leaseToken: claimed?.leaseToken,
        status: "running",
      });
      expect(await harness.dataPlane.jobs.listStatuses()).toHaveLength(3);
    } finally {
      await harness.database.close();
    }
  });
});
