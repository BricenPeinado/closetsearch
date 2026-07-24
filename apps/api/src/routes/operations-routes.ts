import type { IncomingMessage } from "node:http";
import { createPersistenceLifecycleHooks } from "../db/persistence-runtime.js";
import { renderMetrics, setGauge } from "../metrics.js";
import { createProviderRuntime } from "../providers/registry.js";
import type { RouteResult } from "./route-result.js";

const persistenceLifecycle = createPersistenceLifecycleHooks();

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
          realProviders:
            activeRealProviderCount > 0 ? "ready" : "not_configured",
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
