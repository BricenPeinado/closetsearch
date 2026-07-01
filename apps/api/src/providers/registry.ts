import {
  createGrailedProvider,
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
export type ProviderHealthMode = "disabled" | "fixture" | "authorized-live";

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
  supportsPagination: true,
  supportsPagePagination: true,
  supportsCursorPagination: false,
  supportsPriceRange: false,
  supportedListingTypes: ["auction", "buy_now", "unknown"],
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
      "GRAILED_BASE_URL",
      "GRAILED_REQUEST_TIMEOUT_MS",
      "GRAILED_MIN_REQUEST_INTERVAL_MS",
      "GRAILED_MAX_RESULTS_PER_SEARCH",
      "GRAILED_USER_AGENT",
    ],
    createProvider: (config) =>
      createGrailedProvider({
        baseUrl: config.providers.grailed.baseUrl,
        fetchImpl:
          typeof fetch === "function"
            ? ((input, init) => fetch(input, init))
            : undefined,
        maxResultsPerSearch: config.providers.grailed.maxResultsPerSearch,
        minRequestIntervalMs: config.providers.grailed.minRequestIntervalMs,
        requestTimeoutMs: config.providers.grailed.requestTimeoutMs,
        runtimeMode: "authorized-live",
        scrapingAllowed: config.providers.grailed.scrapingAllowed,
        userAgent: config.providers.grailed.userAgent,
      }),
  },
];

function getProviderToggle(
  config: ProviderRuntimeConfig,
  providerId: string,
): ProviderToggleConfig {
  if (providerId === "mock") return config.providers.mock;
  if (providerId === "grailed") return config.providers.grailed;
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
    const hasAuthorization = !requiresAuthorization || toggle.scrapingAllowed === true;

    if (!toggle.enabled) reasons.push("disabled");
    if (!toggle.configured) reasons.push("missing_configuration");
    if (requiresAuthorization && !hasAuthorization) reasons.push("scraping_not_authorized");
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
          "The " + definition.displayName + " provider is enabled but missing required runtime configuration.",
        );
      } else if (requiresAuthorization && !hasAuthorization) {
        failure = createPreflightFailure(
          definition,
          "authorization_required",
          "The Grailed provider is enabled but GRAILED_SCRAPING_ALLOWED=true has not been set alongside documented written permission.",
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
          : "authorized-live"
        : "disabled",
      enabled: toggle.enabled,
      configured: toggle.configured,
      active: canActivate,
      implementationStatus: definition.implementationStatus,
      requiredEnvVars: definition.requiredEnvVars,
      capabilities: definition.capabilities,
      reasons,
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
