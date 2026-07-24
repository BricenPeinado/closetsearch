import type { IncomingMessage } from "node:http";
import {
  createPersistenceLifecycleHooks,
  getPostgresDataPlane,
} from "../db/persistence-runtime.js";
import { clearGaugeFamily, renderMetrics, setGauge } from "../metrics.js";
import { createProviderRuntime } from "../providers/registry.js";
import type { RouteResult } from "./route-result.js";

const persistenceLifecycle = createPersistenceLifecycleHooks();
const workerJobStatuses = [
  "dead_letter",
  "paused",
  "queued",
  "retry_wait",
  "running",
  "succeeded",
] as const;
const providerHealthStates = ["blocked", "degraded", "disabled", "healthy", "unavailable"] as const;
const operationsGaugeFamilies = [
  "closetsearch_ingestion_consecutive_failures",
  "closetsearch_ingestion_lag_seconds",
  "closetsearch_ingestion_never_succeeded",
  "closetsearch_operations_metrics_available",
  "closetsearch_provider_health_consecutive_failures",
  "closetsearch_provider_health_latency_ms",
  "closetsearch_provider_health_state",
  "closetsearch_worker_jobs",
];

async function getPostgresOperationsState() {
  const dataPlane = await getPostgresDataPlane();
  const [jobs, checkpoints, providerHealth] = await Promise.all([
    dataPlane.jobs.listStatuses(),
    dataPlane.jobs.listIngestionCheckpoints(),
    dataPlane.providers.listHealth(),
  ]);

  return {
    checkpoints,
    jobs,
    providerHealth,
  };
}

async function operationsStatusResult(): Promise<RouteResult> {
  try {
    const state = await getPostgresOperationsState();
    const degraded =
      state.jobs.some(
        (job) =>
          job.status === "dead_letter" ||
          job.status === "retry_wait" ||
          job.consecutiveFailures > 0,
      ) ||
      state.checkpoints.some((checkpoint) => checkpoint.consecutiveFailures > 0) ||
      state.providerHealth.some(
        (provider) =>
          provider.state === "blocked" ||
          provider.state === "degraded" ||
          provider.state === "unavailable",
      );

    return {
      body: {
        checkpoints: state.checkpoints.map((checkpoint) => ({
          consecutiveFailures: checkpoint.consecutiveFailures,
          ingestionScope: checkpoint.ingestionScope,
          lastErrorCode: checkpoint.lastErrorCode,
          lastSuccessAt: checkpoint.lastSuccessAt?.toISOString(),
          nextRunAt: checkpoint.nextRunAt.toISOString(),
          providerId: checkpoint.providerId,
        })),
        jobs: state.jobs.map((job) => ({
          attemptCount: job.attemptCount,
          consecutiveFailures: job.consecutiveFailures,
          enabled: job.enabled,
          jobType: job.jobType,
          lastErrorCode: job.lastErrorCode,
          lastFailedAt: job.lastFailedAt?.toISOString(),
          lastStartedAt: job.lastStartedAt?.toISOString(),
          lastSucceededAt: job.lastSucceededAt?.toISOString(),
          nextRunAt: job.runAfter.toISOString(),
          status: job.status,
        })),
        providers: state.providerHealth.map((provider) => ({
          circuitOpenUntil: provider.circuitOpenUntil?.toISOString(),
          consecutiveFailures: provider.consecutiveFailures,
          errorCode: provider.errorCode,
          lastCheckedAt: provider.lastCheckedAt.toISOString(),
          lastSuccessAt: provider.lastSuccessAt?.toISOString(),
          latencyMs: provider.latencyMs,
          providerId: provider.providerId,
          rateLimitedUntil: provider.rateLimitedUntil?.toISOString(),
          state: provider.state,
        })),
        status: degraded ? "degraded" : "ok",
        timestamp: new Date().toISOString(),
      },
      kind: "json",
      statusCode: 200,
    };
  } catch {
    return {
      body: {
        reason: "operations_state_unavailable",
        status: "unavailable",
        timestamp: new Date().toISOString(),
      },
      kind: "json",
      statusCode: 503,
    };
  }
}

function providerHealthResult(): RouteResult {
  const runtime = createProviderRuntime();

  return {
    body: {
      allowMockFallback: runtime.config.allowMockFallback,
      maxProvidersPerRequest: runtime.config.maxProvidersPerRequest,
      providerRuntimeMode: runtime.config.mode,
      providers: runtime.statuses.map((status) => ({
        active: status.active,
        capabilities: status.capabilities,
        configured: status.configured,
        displayName: status.name,
        enabled: status.enabled,
        id: status.id,
        implementationStatus: status.implementationStatus,
        lastErrorCategory: status.lastErrorCategory,
        mode: status.mode,
        providerMode: status.providerMode,
        reasons: status.reasons,
        requiredEnvVars: status.requiredEnvVars,
        scrapingAllowed: status.scrapingAllowed,
      })),
      requestTimeoutMs: runtime.config.requestTimeoutMs,
    },
    kind: "json",
    statusCode: 200,
  };
}

async function readinessResult(): Promise<RouteResult> {
  try {
    const persistence = await persistenceLifecycle.readiness();
    const providerRuntime = createProviderRuntime();
    const activeRealProviderCount = providerRuntime.activeProviders.filter(
      (provider) => provider.mode === "real",
    ).length;
    const productionProviderReady =
      process.env.NODE_ENV !== "production" || activeRealProviderCount > 0;
    const ready = persistence.ready && productionProviderReady;

    return {
      body: {
        checks: {
          database: persistence.ready ? "ready" : "unavailable",
          persistenceDriver: persistence.driver,
          persistenceReason: persistence.reason,
          realProviders: activeRealProviderCount > 0 ? "ready" : "not_configured",
        },
        service: "closetsearch-api",
        status: ready ? "ready" : "not_ready",
        timestamp: new Date().toISOString(),
      },
      kind: "json",
      statusCode: ready ? 200 : 503,
    };
  } catch {
    return {
      body: {
        checks: {
          database: "unavailable",
        },
        service: "closetsearch-api",
        status: "not_ready",
        timestamp: new Date().toISOString(),
      },
      kind: "json",
      statusCode: 503,
    };
  }
}

async function metricsResult(): Promise<RouteResult> {
  const persistenceMetrics = await persistenceLifecycle.metrics();
  for (const family of operationsGaugeFamilies) {
    clearGaugeFamily(family);
  }
  const pool =
    persistenceMetrics.pool &&
    typeof persistenceMetrics.pool === "object" &&
    !Array.isArray(persistenceMetrics.pool)
      ? (persistenceMetrics.pool as Record<string, unknown>)
      : undefined;

  for (const [state, value] of Object.entries(pool ?? {})) {
    if (typeof value === "number") {
      setGauge(
        "closetsearch_database_pool_connections",
        {
          driver: String(persistenceMetrics.driver ?? "unknown"),
          state,
        },
        value,
      );
    }
  }

  if (persistenceMetrics.driver === "postgres") {
    try {
      const state = await getPostgresOperationsState();

      for (const status of workerJobStatuses) {
        setGauge(
          "closetsearch_worker_jobs",
          { status },
          state.jobs.filter((job) => job.status === status).length,
        );
      }

      for (const provider of state.providerHealth) {
        setGauge(
          "closetsearch_provider_health_consecutive_failures",
          { provider: provider.providerId },
          provider.consecutiveFailures,
        );
        if (provider.latencyMs !== undefined) {
          setGauge(
            "closetsearch_provider_health_latency_ms",
            { provider: provider.providerId },
            provider.latencyMs,
          );
        }
        for (const healthState of providerHealthStates) {
          setGauge(
            "closetsearch_provider_health_state",
            {
              provider: provider.providerId,
              state: healthState,
            },
            provider.state === healthState ? 1 : 0,
          );
        }
      }

      const now = Date.now();
      const checkpointGroups = new Map<
        string,
        {
          consecutiveFailures: number;
          ingestionScope: string;
          lastSuccessAtMs?: number;
          neverSucceeded: boolean;
          providerId: string;
        }
      >();

      for (const checkpoint of state.checkpoints) {
        const key = `${checkpoint.providerId}\u0000${checkpoint.ingestionScope}`;
        const existing = checkpointGroups.get(key);
        const lastSuccessAtMs = checkpoint.lastSuccessAt?.getTime();
        checkpointGroups.set(key, {
          consecutiveFailures: Math.max(
            existing?.consecutiveFailures ?? 0,
            checkpoint.consecutiveFailures,
          ),
          ingestionScope: checkpoint.ingestionScope,
          lastSuccessAtMs:
            lastSuccessAtMs === undefined
              ? existing?.lastSuccessAtMs
              : Math.min(existing?.lastSuccessAtMs ?? lastSuccessAtMs, lastSuccessAtMs),
          neverSucceeded:
            (existing?.neverSucceeded ?? false) || checkpoint.lastSuccessAt === undefined,
          providerId: checkpoint.providerId,
        });
      }

      for (const checkpoint of checkpointGroups.values()) {
        setGauge(
          "closetsearch_ingestion_consecutive_failures",
          {
            provider: checkpoint.providerId,
            scope: checkpoint.ingestionScope,
          },
          checkpoint.consecutiveFailures,
        );
        setGauge(
          "closetsearch_ingestion_never_succeeded",
          {
            provider: checkpoint.providerId,
            scope: checkpoint.ingestionScope,
          },
          checkpoint.neverSucceeded ? 1 : 0,
        );
        if (!checkpoint.neverSucceeded && checkpoint.lastSuccessAtMs !== undefined) {
          setGauge(
            "closetsearch_ingestion_lag_seconds",
            {
              provider: checkpoint.providerId,
              scope: checkpoint.ingestionScope,
            },
            Math.max(0, (now - checkpoint.lastSuccessAtMs) / 1_000),
          );
        }
      }
      setGauge("closetsearch_operations_metrics_available", { driver: "postgres" }, 1);
    } catch {
      setGauge("closetsearch_operations_metrics_available", { driver: "postgres" }, 0);
    }
  } else {
    setGauge(
      "closetsearch_operations_metrics_available",
      { driver: String(persistenceMetrics.driver ?? "unknown") },
      0,
    );
  }

  return {
    body: renderMetrics(),
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    },
    kind: "text",
    statusCode: 200,
  };
}

export async function handleOperationsRoute(
  request: IncomingMessage,
  requestUrl: URL,
): Promise<RouteResult | undefined> {
  if ((request.method ?? "GET") !== "GET") {
    return undefined;
  }

  switch (requestUrl.pathname) {
    case "/health/live":
      return {
        body: {
          service: "closetsearch-api",
          status: "alive",
          timestamp: new Date().toISOString(),
        },
        kind: "json",
        statusCode: 200,
      };
    case "/health/ready":
      return readinessResult();
    case "/metrics":
      return metricsResult();
    case "/operations/status":
      return operationsStatusResult();
    case "/health":
      return {
        body: {
          service: "closetsearch-api",
          status: "ok",
          timestamp: new Date().toISOString(),
        },
        kind: "json",
        statusCode: 200,
      };
    case "/providers/health":
      return providerHealthResult();
    default:
      return undefined;
  }
}
