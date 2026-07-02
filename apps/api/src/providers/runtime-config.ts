export type ProviderRuntimeMode = "mock" | "hybrid" | "real";

export interface ProviderToggleConfig {
  baseUrl?: string;
  configured: boolean;
  enabled: boolean;
  maxResultsPerSearch?: number;
  minRequestIntervalMs?: number;
  requestTimeoutMs?: number;
  scrapingAllowed?: boolean;
  userAgent?: string;
}

export interface ProviderRuntimeConfig {
  allowMockFallback: boolean;
  maxProvidersPerRequest: number;
  mode: ProviderRuntimeMode;
  providers: {
    grailed: ProviderToggleConfig;
    mock: ProviderToggleConfig;
  };
  requestTimeoutMs: number;
}

export type ProviderEnvironment = Record<string, string | undefined>;

const defaultProviderRuntimeMode: ProviderRuntimeMode = "mock";
const defaultRequestTimeoutMs = 10_000;
const defaultMaxProvidersPerRequest = 2;
const defaultGrailedBaseUrl = "https://www.grailed.com";
const defaultGrailedRequestTimeoutMs = 5_000;
const defaultGrailedMinRequestIntervalMs = 3_000;
const defaultGrailedMaxResultsPerSearch = 24;
const defaultGrailedUserAgent = "ClosetSearchBot/0.1 contact:<project-contact-email>";

function parseBooleanFlag(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return fallback;
  }
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!value) return fallback;
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsedValue));
}

function parseProviderRuntimeMode(
  value: string | undefined,
  fallback: ProviderRuntimeMode,
): ProviderRuntimeMode {
  switch (value?.trim().toLowerCase()) {
    case "mock":
    case "hybrid":
    case "real":
      return value.trim().toLowerCase() as ProviderRuntimeMode;
    default:
      return fallback;
  }
}

function normalizeOptionalString(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

export function loadProviderRuntimeConfig(
  env: ProviderEnvironment = process.env,
): ProviderRuntimeConfig {
  const grailedBaseUrl =
    normalizeOptionalString(env.GRAILED_BASE_URL) ?? defaultGrailedBaseUrl;
  const grailedUserAgent =
    normalizeOptionalString(env.GRAILED_USER_AGENT) ?? defaultGrailedUserAgent;
  const grailedScrapingAllowed = parseBooleanFlag(env.GRAILED_SCRAPING_ALLOWED, false);
  const grailedEnabled = parseBooleanFlag(
    env.GRAILED_PROVIDER_ENABLED,
    grailedScrapingAllowed,
  );
  const runtimeModeFallback =
    grailedEnabled && grailedScrapingAllowed
      ? "real"
      : defaultProviderRuntimeMode;

  return {
    mode: parseProviderRuntimeMode(env.PROVIDER_RUNTIME_MODE, runtimeModeFallback),
    allowMockFallback: parseBooleanFlag(env.PROVIDER_ALLOW_MOCK_FALLBACK, true),
    requestTimeoutMs: parsePositiveInteger(
      env.PROVIDER_REQUEST_TIMEOUT_MS,
      defaultRequestTimeoutMs,
      1_000,
      60_000,
    ),
    maxProvidersPerRequest: parsePositiveInteger(
      env.PROVIDER_MAX_ACTIVE_PROVIDERS,
      defaultMaxProvidersPerRequest,
      1,
      5,
    ),
    providers: {
      mock: {
        enabled: parseBooleanFlag(env.PROVIDER_MOCK_ENABLED, true),
        configured: true,
      },
      grailed: {
        enabled: grailedEnabled,
        configured: Boolean(grailedBaseUrl && grailedUserAgent),
        baseUrl: grailedBaseUrl,
        scrapingAllowed: grailedScrapingAllowed,
        requestTimeoutMs: parsePositiveInteger(
          env.GRAILED_REQUEST_TIMEOUT_MS,
          defaultGrailedRequestTimeoutMs,
          1_000,
          60_000,
        ),
        minRequestIntervalMs: parsePositiveInteger(
          env.GRAILED_MIN_REQUEST_INTERVAL_MS,
          defaultGrailedMinRequestIntervalMs,
          500,
          60_000,
        ),
        maxResultsPerSearch: parsePositiveInteger(
          env.GRAILED_MAX_RESULTS_PER_SEARCH,
          defaultGrailedMaxResultsPerSearch,
          1,
          100,
        ),
        userAgent: grailedUserAgent,
      },
    },
  };
}
