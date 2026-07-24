import type { IncomingMessage } from "node:http";
import type { PremiumAccess } from "@closetsearch/shared";
import { getOptionalAuthContext } from "../auth/auth-context.js";
import { resolvePersistenceDriver } from "../db/persistence-driver.js";
import { getPostgresDataPlane } from "../db/persistence-runtime.js";
import { PersistedEntitlementService } from "../services/entitlementService.js";
import { PostgresObservedAnalyticsService } from "../services/postgresAnalyticsService.js";
import type { RouteResult } from "./route-result.js";

const analyticsPaths = new Set([
  "/analytics/market-insights",
  "/analytics/overview",
  "/analytics/underpriced",
]);

function lockedResult(userId?: string): RouteResult {
  return {
    body: {
      locked: true,
      message:
        "Observed market analytics require an active persisted entitlement. Access is never inferred from a username.",
      premiumAccess: userId
        ? {
            isPremium: false,
            planName: "Free",
            userId,
          }
        : undefined,
    },
    kind: "json",
    statusCode: 200,
  };
}

async function resolvePremiumAccess(userId: string): Promise<PremiumAccess> {
  if (resolvePersistenceDriver() !== "postgres") {
    return {
      isPremium: false,
      planName: "Free",
      userId,
    };
  }

  return new PersistedEntitlementService(await getPostgresDataPlane()).getPremiumAccess(userId);
}

export async function handleAnalyticsRoute(
  request: IncomingMessage,
  requestUrl: URL,
): Promise<RouteResult | undefined> {
  if ((request.method ?? "GET") !== "GET" || !analyticsPaths.has(requestUrl.pathname)) {
    return undefined;
  }

  const user = getOptionalAuthContext(request)?.user;

  if (!user) {
    return lockedResult();
  }

  const premiumAccess = await resolvePremiumAccess(user.id);

  if (!premiumAccess.isPremium) {
    return lockedResult(user.id);
  }

  const analytics = new PostgresObservedAnalyticsService(await getPostgresDataPlane());

  if (requestUrl.pathname === "/analytics/overview") {
    return {
      body: {
        locked: false,
        overview: await analytics.getOverview(),
        premiumAccess,
        sampleData: false,
      },
      kind: "json",
      statusCode: 200,
    };
  }

  if (requestUrl.pathname === "/analytics/market-insights") {
    const insights = await analytics.getMarketInsights();

    return {
      body: {
        ...insights,
        locked: false,
        premiumAccess,
        sampleData: false,
      },
      kind: "json",
      statusCode: 200,
    };
  }

  const signals = await analytics.getUnderpricedSignals();

  return {
    body: {
      ...signals,
      locked: false,
      premiumAccess,
      sampleData: false,
    },
    kind: "json",
    statusCode: 200,
  };
}
