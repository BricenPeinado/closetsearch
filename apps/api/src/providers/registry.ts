import {
  createEbayProvider,
  createGrailedProvider,
  ebayProviderCapabilities,
  mockProvider,
  type Provider,
  type ProviderCapabilities,
  type ProviderFailure,
} from "@closetsearch/providers";
import {
  loadProviderRuntimeConfig,
  type ProviderRuntimeConfig,
  type ProviderToggleConfig,
} from "./runtime-config.js";

export type RegisteredProviderMode = "mock" | "real";
export type ProviderImplementationStatus = "available" | "planned";
export type ProviderHealthMode = "disabled" | "fixture" | "authorized-live" | "official-api";

export interface ProviderDefinition {
  capabilities?: ProviderCapabilities;
  createProvider?: (config: ProviderRuntimeConfig) => Provider;
  displayName: string;
  id: string;
  implementationStatus: ProviderImplementationStatus;
  mode: RegisteredProviderMode;
  requiredEnvVars?: string[];
}

export interface ProviderPreflightFailure {
  failure: ProviderFailure;
  providerId: string;
  providerMode: RegisteredProviderMode;
  providerName: string;
}

export interface ProviderStatus {
  active: boolean;
  capabilities?: ProviderCapabilities;
  configured: boolean;
  enabled: boolean;
  id: string;
  implementationStatus: ProviderImplementationStatus;
  lastErrorCategory?: ProviderFailure["code"];
  mode: ProviderHealthMode;
  name: string;
  providerMode: RegisteredProviderMode;
  reasons: string[];
  requiredEnvVars?: string[];
  authorizationReferencePresent?: boolean;
  scrapingAllowed?: boolean;
}

export interface ActiveProviderRegistration {
  mode: RegisteredProviderMode;
  name: string;
  provider: Provider;
}

export interface ProviderRuntime {
  activeProviders: ActiveProviderRegistration[];
  config: ProviderRuntimeConfig;
  preflightFailures: ProviderPreflightFailure[];
  statuses: ProviderStatus[];
}

const grailedCapabilities: ProviderCapabilities = {
  dataOrigin: "authorized_scraping",
  paginationModel: "page",
  requiresAttribution: true,
  supportsActiveListings: true,
  supportsAttribution: true,
  supportsBrandFilter: false,
  supportsCategoryFilter: false,
  supportsChangeFeed: false,
  supportsConditionFilter: false,
  supportsPagination: true,
  supportsPagePagination: true,
  supportsCursorPagination: false,
  supportsPriceRange: false,
  supportsSearch: true,
  supportsSellerMetadata: true,
  supportsShipping: false,
  supportsSizeFilter: false,
  supportsSoldListings: true,
  supportsWebhooks: false,
  supportedListingTypes: ["auction", "buy_now", "unknown"],
  supportedMarketStatuses: ["active", "sold"],
  supportedSortModes: ["relevance", "newest"],
};

const defaultProviderDefinitions: ProviderDefinition[] = [
  {
    id: mockProvider.id,
    displayName: mockProvider.name,
    mode: "mock",
    implementationStatus: "available",
    capabilities: mockProvider.capabilities,
    createProvider: () => mockProvider,
  },
  {
    id: "grailed",
    displayName: "Grailed",
    mode: "real",
    implementationStatus: "available",
    capabilities: grailedCapabilities,
    requiredEnvVars: [
      "GRAILED_PROVIDER_ENABLED",
      "GRAILED_SCRAPING_ALLOWED",
      "GRAILED_AUTHORIZATION_REFERENCE",
      "GRAILED_BASE_URL",
      "GRAILED_REQUEST_TIMEOUT_MS",
      "GRAILED_MIN_REQUEST_INTERVAL_MS",
      "GRAILED_MAX_RESULTS_PER_SEARCH",
      "GRAILED_MAX_CONCURRENCY",
      "GRAILED_MAX_RETRIES",
      "GRAILED_BASE_BACKOFF_MS",
      "GRAILED_MAX_RETRY_AFTER_MS",
      "GRAILED_CIRCUIT_BREAKER_FAILURE_THRESHOLD",
      "GRAILED_CIRCUIT_BREAKER_COOLDOWN_MS",
      "GRAILED_USER_AGENT",
    ],
    createProvider: (config) =>
      createGrailedProvider({
        authorizationReference: config.providers.grailed.authorizationReference,
        baseBackoffMs: config.providers.grailed.baseBackoffMs,
        baseUrl: config.providers.grailed.baseUrl,
        circuitBreakerCooldownMs: config.providers.grailed.circuitBreakerCooldownMs,
        circuitBreakerFailureThreshold: config.providers.grailed.circuitBreakerFailureThreshold,
        fetchImpl: typeof fetch === "function" ? (input, init) => fetch(input, init) : undefined,
        maxConcurrency: config.providers.grailed.maxConcurrency,
        maxRetries: config.providers.grailed.maxRetries,
        maxRetryAfterMs: config.providers.grailed.maxRetryAfterMs,
        maxResultsPerSearch: config.providers.grailed.maxResultsPerSearch,
        minRequestIntervalMs: config.providers.grailed.minRequestIntervalMs,
        requestTimeoutMs: config.providers.grailed.requestTimeoutMs,
        runtimeMode: "authorized-live",
        scrapingAllowed: config.providers.grailed.scrapingAllowed,
        userAgent: config.providers.grailed.userAgent,
      }),
  },
  {
    id: "ebay",
    displayName: "eBay",
    mode: "real",
    implementationStatus: "available",
    capabilities: ebayProviderCapabilities,
    requiredEnvVars: [
      "EBAY_PROVIDER_ENABLED",
      "EBAY_CLIENT_ID",
      "EBAY_CLIENT_SECRET",
      "EBAY_MARKETPLACE_ID",
    ],
    createProvider: (config) =>
      createEbayProvider({
        affiliateCampaignId: config.providers.ebay.affiliateCampaignId,
        affiliateReferenceId: config.providers.ebay.affiliateReferenceId,
        apiBaseUrl: config.providers.ebay.apiBaseUrl,
        clientId: config.providers.ebay.clientId,
        clientSecret: config.providers.ebay.clientSecret,
        fetchImpl: typeof fetch === "function" ? (input, init) => fetch(input, init) : undefined,
        identityBaseUrl: config.providers.ebay.identityBaseUrl,
        marketplaceId: config.providers.ebay.marketplaceId,
        maxConcurrency: config.providers.ebay.maxConcurrency,
        maxRetries: config.providers.ebay.maxRetries,
        minRequestIntervalMs: config.providers.ebay.minRequestIntervalMs,
        oauthScope: config.providers.ebay.oauthScope,
        requestTimeoutMs: config.providers.ebay.requestTimeoutMs,
      }),
  },
];

function getProviderToggle(
  config: ProviderRuntimeConfig,
  providerId: string,
): ProviderToggleConfig {
  if (providerId === "mock") return config.providers.mock;
  if (providerId === "grailed") return config.providers.grailed;
  if (providerId === "ebay") return config.providers.ebay;
  return { enabled: false, configured: false };
}

function createPreflightFailure(
  definition: ProviderDefinition,
  code: ProviderFailure["code"],
  message: string,
): ProviderPreflightFailure {
  return {
    providerId: definition.id,
    providerName: definition.displayName,
    providerMode: definition.mode,
    failure: {
      providerId: definition.id,
      code,
      message,
      retryable: code === "timeout" || code === "rate_limited",
    },
  };
}

export function getProviderDefinitions() {
  return [...defaultProviderDefinitions];
}

export function createProviderRuntime(
  config: ProviderRuntimeConfig = loadProviderRuntimeConfig(),
  definitions: ProviderDefinition[] = defaultProviderDefinitions,
): ProviderRuntime {
  const activeProviders: ActiveProviderRegistration[] = [];
  const activeRealProviders: ActiveProviderRegistration[] = [];
  const preflightFailures: ProviderPreflightFailure[] = [];
  const statuses: ProviderStatus[] = [];

  for (const definition of definitions) {
    const toggle = getProviderToggle(config, definition.id);
    const reasons: string[] = [];
    const isSelectedByMode =
      config.mode === "hybrid"
        ? true
        : config.mode === "real"
          ? definition.mode === "real"
          : definition.mode === "mock";
    const requiresAuthorization = definition.id === "grailed";
    const hasAuthorization =
      !requiresAuthorization ||
      (toggle.scrapingAllowed === true && Boolean(toggle.authorizationReference));

    if (!toggle.enabled) reasons.push("disabled");
    if (!toggle.configured) reasons.push("missing_configuration");
    if (requiresAuthorization && toggle.scrapingAllowed !== true) {
      reasons.push("scraping_not_authorized");
    }
    if (requiresAuthorization && !toggle.authorizationReference) {
      reasons.push("authorization_reference_missing");
    }
    if (!definition.createProvider) reasons.push("implementation_pending");
    if (!isSelectedByMode) reasons.push("mode_excluded");

    const canActivate =
      toggle.enabled &&
      toggle.configured &&
      hasAuthorization &&
      Boolean(definition.createProvider) &&
      isSelectedByMode;

    let lastErrorCategory: ProviderFailure["code"] | undefined;

    if (canActivate && definition.createProvider) {
      const registration = {
        mode: definition.mode,
        name: definition.displayName,
        provider: definition.createProvider(config),
      } satisfies ActiveProviderRegistration;

      if (definition.mode === "real") activeRealProviders.push(registration);
      else activeProviders.push(registration);
    } else if (toggle.enabled && isSelectedByMode) {
      let failure: ProviderPreflightFailure | undefined;

      if (!toggle.configured) {
        failure = createPreflightFailure(
          definition,
          "unavailable",
          "The " +
            definition.displayName +
            " provider is enabled but missing required runtime configuration.",
        );
      } else if (requiresAuthorization && !hasAuthorization) {
        failure = createPreflightFailure(
          definition,
          "authorization_required",
          "The Grailed provider is enabled but both GRAILED_SCRAPING_ALLOWED=true and GRAILED_AUTHORIZATION_REFERENCE are required.",
        );
      } else if (!definition.createProvider) {
        failure = createPreflightFailure(
          definition,
          "unavailable",
          "The " + definition.displayName + " provider is enabled but not implemented yet.",
        );
      }

      if (failure) {
        lastErrorCategory = failure.failure.code;
        preflightFailures.push(failure);
      }
    }

    statuses.push({
      id: definition.id,
      name: definition.displayName,
      providerMode: definition.mode,
      mode: canActivate
        ? definition.mode === "mock"
          ? "fixture"
          : definition.id === "ebay"
            ? "official-api"
            : "authorized-live"
        : "disabled",
      enabled: toggle.enabled,
      configured: toggle.configured,
      active: canActivate,
      implementationStatus: definition.implementationStatus,
      requiredEnvVars: definition.requiredEnvVars,
      capabilities: definition.capabilities,
      reasons,
      authorizationReferencePresent:
        definition.id === "grailed" ? Boolean(toggle.authorizationReference) : undefined,
      scrapingAllowed: definition.id === "grailed" ? toggle.scrapingAllowed : undefined,
      lastErrorCategory,
    });
  }

  activeProviders.push(...activeRealProviders);

  if (config.mode === "real" && activeRealProviders.length === 0 && config.allowMockFallback) {
    const fallbackStatus = statuses.find((status) => status.id === "mock");
    const fallbackProvider = definitions.find((definition) => definition.id === "mock");
    const canFallbackToMock =
      fallbackStatus?.enabled === true &&
      fallbackStatus.configured === true &&
      Boolean(fallbackProvider?.createProvider);

    if (canFallbackToMock && fallbackProvider?.createProvider) {
      activeProviders.unshift({
        mode: "mock",
        name: fallbackProvider.displayName,
        provider: fallbackProvider.createProvider(config),
      });

      if (fallbackStatus) {
        fallbackStatus.active = true;
        fallbackStatus.mode = "fixture";
        fallbackStatus.reasons = fallbackStatus.reasons.filter(
          (reason) => reason !== "mode_excluded",
        );
        fallbackStatus.reasons.push("mock_fallback");
      }
    }
  }

  return {
    config,
    activeProviders: activeProviders.slice(0, config.maxProvidersPerRequest),
    preflightFailures,
    statuses,
  };
}
