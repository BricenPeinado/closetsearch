import { getAuthConfig } from "./auth/config.js";
import { resolvePersistenceDriver, type PersistenceDriver } from "./db/persistence-driver.js";
import { loadPostgresRuntimeConfig } from "./db/postgres/config.js";
import { getEngagementRuntimeConfig } from "./services/durableEngagementService.js";
import { readRecommendationRuntimeConfig } from "./services/mlRecommendationRuntimeService.js";
import {
  alertDeliveryEnabled,
  createEmailTransportFromEnvironment,
  createSmsTransportFromEnvironment,
} from "./services/notificationTransports.js";
import { loadProviderRuntimeConfig } from "./providers/runtime-config.js";

export interface StartupConfig {
  host: string;
  persistenceDriver: PersistenceDriver;
  port: number;
  shutdownTimeoutMs: number;
}

function parsePositiveInteger(value: string | undefined, fallback: number, maximum: number) {
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

function validateProductionProviderOrigin(
  value: string | undefined,
  label: string,
  allowedOrigins: ReadonlySet<string>,
) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return;
  }

  let url: URL;

  try {
    url = new URL(normalizedValue);
  } catch {
    throw new Error(`${label} must be an official absolute HTTPS origin.`);
  }

  if (
    url.protocol !== "https:" ||
    !allowedOrigins.has(url.origin) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be an official absolute HTTPS origin.`);
  }
}

function validateProductionPublicUrl(value: string | undefined, label: string) {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${label} is required when outbound delivery is configured.`);
  }

  let url: URL;

  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL.`);
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be an absolute HTTPS URL.`);
  }
}

export function validateStartupEnvironment(
  env: Record<string, string | undefined> = process.env,
): StartupConfig {
  const authConfig = getAuthConfig(env);
  const persistenceDriver = resolvePersistenceDriver(env);
  getEngagementRuntimeConfig(env);
  const recommendationConfig = readRecommendationRuntimeConfig(env);
  const providerConfig = loadProviderRuntimeConfig(env);
  const emailTransport = createEmailTransportFromEnvironment(env);
  const smsTransport = createSmsTransportFromEnvironment(env);

  if (persistenceDriver === "postgres") {
    loadPostgresRuntimeConfig(env);
  }

  if (env.NODE_ENV === "production") {
    const recommendationMode = env.CLOSETSEARCH_RECOMMENDATION_MODE?.trim() ?? "disabled";

    if (!["active", "disabled", "shadow"].includes(recommendationMode)) {
      throw new Error("CLOSETSEARCH_RECOMMENDATION_MODE must be disabled, shadow, or active.");
    }

    if (recommendationMode !== "disabled" && !recommendationConfig.artifactPath) {
      throw new Error(
        "CLOSETSEARCH_RECOMMENDATION_ARTIFACT_PATH is required for shadow or active recommendation mode.",
      );
    }

    if (recommendationMode === "active" && !recommendationConfig.promotionApproved) {
      throw new Error(
        "Active recommendation mode requires CLOSETSEARCH_RECOMMENDATION_PROMOTION_APPROVED=true.",
      );
    }

    if (persistenceDriver !== "postgres") {
      throw new Error("PostgreSQL persistence is required in production.");
    }

    if (authConfig.tokenPepper.length < 32) {
      throw new Error("AUTH_SESSION_PEPPER must contain at least 32 characters in production.");
    }

    if ((env.NOTIFICATION_DESTINATION_PEPPER?.trim().length ?? 0) < 32) {
      throw new Error(
        "NOTIFICATION_DESTINATION_PEPPER must contain at least 32 characters in production.",
      );
    }

    if (!authConfig.cookieSecure) {
      throw new Error("AUTH_COOKIE_SECURE must be true in production.");
    }

    if ((env.OPERATIONS_BEARER_TOKEN?.trim().length ?? 0) < 32) {
      throw new Error("OPERATIONS_BEARER_TOKEN must contain at least 32 characters in production.");
    }

    if (alertDeliveryEnabled(env) && !emailTransport.configured && !smsTransport.configured) {
      throw new Error(
        "ALERT_DELIVERY_ENABLED requires at least one configured email or SMS transport.",
      );
    }

    if (emailTransport.configured) {
      validateProductionPublicUrl(env.ACCOUNT_ACTION_BASE_URL, "ACCOUNT_ACTION_BASE_URL");
      validateProductionPublicUrl(env.ALERT_PUBLIC_BASE_URL, "ALERT_PUBLIC_BASE_URL");

      if ((env.EMAIL_WEBHOOK_SECRET?.trim().length ?? 0) < 32) {
        throw new Error(
          "EMAIL_WEBHOOK_SECRET must contain at least 32 characters when email delivery is configured.",
        );
      }
    }

    if (smsTransport.configured) {
      validateProductionPublicUrl(env.ALERT_PUBLIC_BASE_URL, "ALERT_PUBLIC_BASE_URL");

      if ((env.TWILIO_AUTH_TOKEN?.trim().length ?? 0) < 32) {
        throw new Error(
          "TWILIO_AUTH_TOKEN must contain at least 32 characters when SMS delivery is configured.",
        );
      }
      if (
        env.TWILIO_WEBHOOK_SECRET?.trim() &&
        env.TWILIO_WEBHOOK_SECRET.trim() !== env.TWILIO_AUTH_TOKEN?.trim()
      ) {
        throw new Error(
          "TWILIO_WEBHOOK_SECRET, when set, must equal TWILIO_AUTH_TOKEN because Twilio signs webhooks with the account Auth Token.",
        );
      }
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

    validateProductionProviderOrigin(
      env.EBAY_API_BASE_URL,
      "EBAY_API_BASE_URL",
      new Set(["https://api.ebay.com"]),
    );
    validateProductionProviderOrigin(
      env.EBAY_IDENTITY_BASE_URL,
      "EBAY_IDENTITY_BASE_URL",
      new Set(["https://api.ebay.com"]),
    );
    validateProductionProviderOrigin(
      env.GRAILED_BASE_URL,
      "GRAILED_BASE_URL",
      new Set(["https://www.grailed.com"]),
    );
    validateProductionProviderOrigin(
      env.DEPOP_BASE_URL,
      "DEPOP_BASE_URL",
      new Set(["https://webapi.depop.com"]),
    );
    validateProductionProviderOrigin(
      env.YAHOO_AUCTIONS_JP_BASE_URL,
      "YAHOO_AUCTIONS_JP_BASE_URL",
      new Set(["https://auctions.yahoo.co.jp"]),
    );
    validateProductionProviderOrigin(
      env.MERCARI_JP_BASE_URL,
      "MERCARI_JP_BASE_URL",
      new Set(["https://api.mercari.jp"]),
    );

    const enabledProviders = [
      ["eBay", providerConfig.providers.ebay, false],
      ["Grailed", providerConfig.providers.grailed, true],
      ["Depop", providerConfig.providers.depop, true],
      ["Yahoo! Auctions Japan", providerConfig.providers.yahooAuctionsJp, true],
      ["Mercari Japan", providerConfig.providers.mercariJp, true],
    ] as const;

    for (const [name, provider, requiresScrapingFlag] of enabledProviders) {
      if (!provider.enabled) {
        continue;
      }

      if (!provider.authorizationReference) {
        throw new Error(
          `${name} is enabled in production but its provider-specific authorization reference is missing.`,
        );
      }

      if (requiresScrapingFlag && provider.scrapingAllowed !== true) {
        throw new Error(
          `${name} is enabled in production but its explicit authorized-scraping flag is not true.`,
        );
      }

      if (!provider.configured) {
        throw new Error(`${name} is enabled in production but required configuration is missing.`);
      }
    }
  }

  return {
    host: env.HOST?.trim() || "127.0.0.1",
    persistenceDriver,
    port: parsePositiveInteger(env.PORT, 4_000, 65_535),
    shutdownTimeoutMs: parsePositiveInteger(env.SHUTDOWN_TIMEOUT_MS, 10_000, 60_000),
  };
}
