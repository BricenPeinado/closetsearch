import { getAuthConfig } from "./auth/config.js";
import {
  resolvePersistenceDriver,
  type PersistenceDriver,
} from "./db/persistence-driver.js";
import { loadPostgresRuntimeConfig } from "./db/postgres/config.js";
import { getEngagementRuntimeConfig } from "./services/durableEngagementService.js";
import { readRecommendationRuntimeConfig } from "./services/mlRecommendationRuntimeService.js";

export interface StartupConfig {
  host: string;
  persistenceDriver: PersistenceDriver;
  port: number;
  shutdownTimeoutMs: number;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed < 1 || parsed > maximum) {
    return fallback;
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  switch (value?.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
      return true;
    case "0":
    case "false":
    case "no":
      return false;
    default:
      return fallback;
  }
}

export function validateStartupEnvironment(
  env: Record<string, string | undefined> = process.env,
): StartupConfig {
  const authConfig = getAuthConfig(env);
  const persistenceDriver = resolvePersistenceDriver(env);
  getEngagementRuntimeConfig(env);
  const recommendationConfig = readRecommendationRuntimeConfig(env);

  if (persistenceDriver === "postgres") {
    loadPostgresRuntimeConfig(env);
  }

  if (env.NODE_ENV === "production") {
    const recommendationMode =
      env.CLOSETSEARCH_RECOMMENDATION_MODE?.trim() ?? "disabled";

    if (!["active", "disabled", "shadow"].includes(recommendationMode)) {
      throw new Error(
        "CLOSETSEARCH_RECOMMENDATION_MODE must be disabled, shadow, or active.",
      );
    }

    if (
      recommendationMode !== "disabled" &&
      !recommendationConfig.artifactPath
    ) {
      throw new Error(
        "CLOSETSEARCH_RECOMMENDATION_ARTIFACT_PATH is required for shadow or active recommendation mode.",
      );
    }

    if (
      recommendationMode === "active" &&
      !recommendationConfig.promotionApproved
    ) {
      throw new Error(
        "Active recommendation mode requires CLOSETSEARCH_RECOMMENDATION_PROMOTION_APPROVED=true.",
      );
    }

    if (persistenceDriver !== "postgres") {
      throw new Error("PostgreSQL persistence is required in production.");
    }

    if (authConfig.tokenPepper.length < 32) {
      throw new Error(
        "AUTH_SESSION_PEPPER must contain at least 32 characters in production.",
      );
    }

    if (!authConfig.cookieSecure) {
      throw new Error("AUTH_COOKIE_SECURE must be true in production.");
    }

    if (
      authConfig.allowedOrigins.size === 0 ||
      Array.from(authConfig.allowedOrigins).some(
        (origin) =>
          origin.startsWith("http://") ||
          origin.includes("localhost") ||
          origin.includes("127.0.0.1"),
      )
    ) {
      throw new Error(
        "AUTH_ALLOWED_ORIGINS must contain only explicit HTTPS origins in production.",
      );
    }

    const providerMode = env.PROVIDER_RUNTIME_MODE?.trim().toLowerCase();
    const mockFallback = parseBoolean(env.PROVIDER_ALLOW_MOCK_FALLBACK, false);

    if (providerMode !== "real") {
      throw new Error("PROVIDER_RUNTIME_MODE must be real in production.");
    }

    if (mockFallback || parseBoolean(env.PROVIDER_MOCK_ENABLED, false)) {
      throw new Error("Mock providers and fallback must be disabled in production.");
    }
  }

  return {
    host: env.HOST?.trim() || "127.0.0.1",
    persistenceDriver,
    port: parsePositiveInteger(env.PORT, 4_000, 65_535),
    shutdownTimeoutMs: parsePositiveInteger(
      env.SHUTDOWN_TIMEOUT_MS,
      10_000,
      60_000,
    ),
  };
}
