import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderRuntime: vi.fn(),
  getPostgresDataPlane: vi.fn(),
  metrics: vi.fn(),
  readiness: vi.fn(),
}));

vi.mock("../db/persistence-runtime.js", () => ({
  createPersistenceLifecycleHooks: () => ({
    metrics: mocks.metrics,
    readiness: mocks.readiness,
  }),
  getPostgresDataPlane: mocks.getPostgresDataPlane,
}));

vi.mock("../providers/registry.js", () => ({
  createProviderRuntime: mocks.createProviderRuntime,
}));

import { resetMetrics } from "../metrics.js";
import { handleOperationsRoute } from "./operations-routes.js";

function createRequest() {
  return {
    method: "GET",
  } as IncomingMessage;
}

function dataPlaneState(input?: {
  checkpoints?: unknown[];
  jobs?: unknown[];
  providerHealth?: unknown[];
}) {
  return {
    jobs: {
      listIngestionCheckpoints: vi.fn().mockResolvedValue(input?.checkpoints ?? []),
      listStatuses: vi.fn().mockResolvedValue(input?.jobs ?? []),
    },
    providers: {
      listHealth: vi.fn().mockResolvedValue(input?.providerHealth ?? []),
    },
  };
}

describe("operations routes", () => {
  beforeEach(() => {
    resetMetrics();
    vi.clearAllMocks();
    mocks.metrics.mockResolvedValue({
      driver: "postgres",
      pool: {
        idleCount: 2,
        totalCount: 4,
      },
    });
    mocks.readiness.mockResolvedValue({
      driver: "postgres",
      ready: true,
    });
    mocks.createProviderRuntime.mockReturnValue({
      activeProviders: [],
      config: {
        allowMockFallback: false,
        maxProvidersPerRequest: 2,
        mode: "real",
        requestTimeoutMs: 2_000,
      },
      statuses: [],
    });
    mocks.getPostgresDataPlane.mockResolvedValue(dataPlaneState());
  });

  it("reports durable job, checkpoint, and provider state without job payloads", async () => {
    mocks.getPostgresDataPlane.mockResolvedValue(
      dataPlaneState({
        checkpoints: [
          {
            consecutiveFailures: 1,
            ingestionScope: "active",
            lastErrorCode: "rate_limited",
            lastSuccessAt: new Date("2026-07-24T11:00:00.000Z"),
            nextRunAt: new Date("2026-07-24T12:05:00.000Z"),
            providerId: "ebay",
          },
        ],
        jobs: [
          {
            attemptCount: 2,
            consecutiveFailures: 1,
            enabled: true,
            jobType: "provider_ingestion",
            lastErrorCode: "rate_limited",
            lastFailedAt: new Date("2026-07-24T11:59:00.000Z"),
            lastStartedAt: new Date("2026-07-24T11:58:00.000Z"),
            lastSucceededAt: new Date("2026-07-24T11:00:00.000Z"),
            payload: {
              authorization: "must-not-leak",
            },
            runAfter: new Date("2026-07-24T12:05:00.000Z"),
            status: "retry_wait",
          },
        ],
        providerHealth: [
          {
            circuitOpenUntil: new Date("2026-07-24T12:05:00.000Z"),
            consecutiveFailures: 1,
            errorCode: "rate_limited",
            lastCheckedAt: new Date("2026-07-24T12:00:00.000Z"),
            lastSuccessAt: new Date("2026-07-24T11:00:00.000Z"),
            latencyMs: 125,
            metadata: {
              secret: "must-not-leak",
            },
            providerId: "ebay",
            rateLimitedUntil: new Date("2026-07-24T12:05:00.000Z"),
            state: "degraded",
          },
        ],
      }),
    );

    const result = await handleOperationsRoute(
      createRequest(),
      new URL("http://localhost/operations/status"),
    );

    expect(result).toMatchObject({
      body: {
        checkpoints: [
          {
            consecutiveFailures: 1,
            ingestionScope: "active",
            providerId: "ebay",
          },
        ],
        jobs: [
          {
            jobType: "provider_ingestion",
            status: "retry_wait",
          },
        ],
        providers: [
          {
            providerId: "ebay",
            state: "degraded",
          },
        ],
        status: "degraded",
      },
      kind: "json",
      statusCode: 200,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("returns a stable unavailable response when PostgreSQL state cannot be read", async () => {
    mocks.getPostgresDataPlane.mockRejectedValue(new Error("password=must-not-leak"));

    const result = await handleOperationsRoute(
      createRequest(),
      new URL("http://localhost/operations/status"),
    );

    expect(result).toMatchObject({
      body: {
        reason: "operations_state_unavailable",
        status: "unavailable",
      },
      kind: "json",
      statusCode: 503,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("exports aggregated PostgreSQL gauges and clears stale values after failure", async () => {
    const now = Date.now();
    mocks.getPostgresDataPlane.mockResolvedValue(
      dataPlaneState({
        checkpoints: [
          {
            consecutiveFailures: 1,
            ingestionScope: "active",
            lastSuccessAt: new Date(now - 10_000),
            providerId: "ebay",
          },
          {
            consecutiveFailures: 3,
            ingestionScope: "active",
            lastSuccessAt: new Date(now - 20_000),
            providerId: "ebay",
          },
          {
            consecutiveFailures: 0,
            ingestionScope: "sold",
            providerId: "ebay",
          },
        ],
        jobs: [
          {
            status: "running",
          },
        ],
        providerHealth: [
          {
            consecutiveFailures: 2,
            lastCheckedAt: new Date(now),
            latencyMs: 125,
            providerId: "ebay",
            state: "degraded",
          },
        ],
      }),
    );

    const first = await handleOperationsRoute(createRequest(), new URL("http://localhost/metrics"));
    const firstBody = String(first?.body);

    expect(firstBody).toContain('closetsearch_worker_jobs{status="running"} 1');
    expect(firstBody).toContain(
      'closetsearch_ingestion_consecutive_failures{provider="ebay",scope="active"} 3',
    );
    expect(firstBody).toContain(
      'closetsearch_ingestion_never_succeeded{provider="ebay",scope="sold"} 1',
    );
    expect(firstBody).toMatch(
      /closetsearch_ingestion_lag_seconds\{provider="ebay",scope="active"\} 2\d(?:\.\d+)?/,
    );
    expect(firstBody).toContain('closetsearch_operations_metrics_available{driver="postgres"} 1');

    mocks.getPostgresDataPlane.mockRejectedValue(new Error("database offline"));
    const second = await handleOperationsRoute(
      createRequest(),
      new URL("http://localhost/metrics"),
    );
    const secondBody = String(second?.body);

    expect(secondBody).toContain('closetsearch_operations_metrics_available{driver="postgres"} 0');
    expect(secondBody).not.toContain("closetsearch_worker_jobs{");
    expect(secondBody).not.toContain("closetsearch_ingestion_lag_seconds{");
    expect(secondBody).not.toContain("closetsearch_provider_health_latency_ms{");
  });
});
