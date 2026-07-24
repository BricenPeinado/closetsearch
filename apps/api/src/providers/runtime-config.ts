export type ProviderRuntimeMode = "mock" | "hybrid" | "real";

export interface ProviderToggleConfig {
  affiliateCampaignId?: string;
  affiliateReferenceId?: string;
  apiBaseUrl?: string;
  authorizationReference?: string;
  baseBackoffMs?: number;
  baseUrl?: string;
  circuitBreakerCooldownMs?: number;
  circuitBreakerFailureThreshold?: number;
  clientId?: string;
  clientSecret?: string;
  configured: boolean;
  enabled: boolean;
  identityBaseUrl?: string;
  marketplaceId?: string;
  maxConcurrency?: number;
  maxRetries?: number;
  maxRetryAfterMs?: number;
  maxResultsPerSearch?: number;
  minRequestIntervalMs?: number;
  oauthScope?: string;
  requestTimeoutMs?: number;
  scrapingAllowed?: boolean;
  userAgent?: string;
}

export interface ProviderRuntimeConfig {
  allowMockFallback: boolean;
  maxProvidersPerRequest: number;
  mode: ProviderRuntimeMode;
  providers: {
    ebay: ProviderToggleConfig;
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
const defaultGrailedMaxConcurrency = 2;
const defaultGrailedMaxRetries = 2;
const defaultGrailedBaseBackoffMs = 250;
const defaultGrailedMaxRetryAfterMs = 60_000;
const defaultGrailedCircuitBreakerFailureThreshold = 5;
const defaultGrailedCircuitBreakerCooldownMs = 30_000;
const defaultGrailedUserAgent = "ClosetSearchBot/0.1 contact:<project-contact-email>";
const defaultEbayApiBaseUrl = "https://api.ebay.com";
const defaultEbayIdentityBaseUrl = "https://api.ebay.com";
const defaultEbayMarketplaceId = "EBAY_US";
const defaultEbayOauthScope = "https://api.ebay.com/oauth/api_scope";

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
  const grailedBaseUrl = normalizeOptionalString(env.GRAILED_BASE_URL) ?? defaultGrailedBaseUrl;
  const grailedUserAgent =
    normalizeOptionalString(env.GRAILED_USER_AGENT) ?? defaultGrailedUserAgent;
  const grailedScrapingAllowed = parseBooleanFlag(env.GRAILED_SCRAPING_ALLOWED, false);
  const grailedAuthorizationReference = normalizeOptionalString(
    env.GRAILED_AUTHORIZATION_REFERENCE,
  );
  const grailedEnabled = parseBooleanFlag(env.GRAILED_PROVIDER_ENABLED, grailedScrapingAllowed);
  const ebayClientId = normalizeOptionalString(env.EBAY_CLIENT_ID);
  const ebayClientSecret = normalizeOptionalString(env.EBAY_CLIENT_SECRET);
  const ebayEnabled = parseBooleanFlag(env.EBAY_PROVIDER_ENABLED, false);
  const isProduction = env.NODE_ENV?.trim().toLowerCase() === "production";
  const hasAuthorizedRealProvider =
    (grailedEnabled && grailedScrapingAllowed && Boolean(grailedAuthorizationReference)) ||
    (ebayEnabled && Boolean(ebayClientId && ebayClientSecret));
  const runtimeModeFallback = isProduction
    ? "real"
    : hasAuthorizedRealProvider
      ? "real"
      : defaultProviderRuntimeMode;

  return {
    mode: parseProviderRuntimeMode(env.PROVIDER_RUNTIME_MODE, runtimeModeFallback),
    allowMockFallback: isProduction
      ? false
      : parseBooleanFlag(env.PROVIDER_ALLOW_MOCK_FALLBACK, true),
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
        enabled: parseBooleanFlag(env.PROVIDER_MOCK_ENABLED, !isProduction),
        configured: true,
      },
      grailed: {
        enabled: grailedEnabled,
        configured: Boolean(grailedBaseUrl && grailedUserAgent),
        baseUrl: grailedBaseUrl,
        authorizationReference: grailedAuthorizationReference,
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
        maxConcurrency: parsePositiveInteger(
          env.GRAILED_MAX_CONCURRENCY,
          defaultGrailedMaxConcurrency,
          1,
          10,
        ),
        maxRetries: parsePositiveInteger(env.GRAILED_MAX_RETRIES, defaultGrailedMaxRetries, 0, 5),
        baseBackoffMs: parsePositiveInteger(
          env.GRAILED_BASE_BACKOFF_MS,
          defaultGrailedBaseBackoffMs,
          0,
          10_000,
        ),
        maxRetryAfterMs: parsePositiveInteger(
          env.GRAILED_MAX_RETRY_AFTER_MS,
          defaultGrailedMaxRetryAfterMs,
          0,
          300_000,
        ),
        circuitBreakerFailureThreshold: parsePositiveInteger(
          env.GRAILED_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
          defaultGrailedCircuitBreakerFailureThreshold,
          1,
          20,
        ),
        circuitBreakerCooldownMs: parsePositiveInteger(
          env.GRAILED_CIRCUIT_BREAKER_COOLDOWN_MS,
          defaultGrailedCircuitBreakerCooldownMs,
          1_000,
          300_000,
        ),
        userAgent: grailedUserAgent,
      },
      ebay: {
        enabled: ebayEnabled,
        configured: Boolean(ebayClientId && ebayClientSecret),
        clientId: ebayClientId,
        clientSecret: ebayClientSecret,
        apiBaseUrl: normalizeOptionalString(env.EBAY_API_BASE_URL) ?? defaultEbayApiBaseUrl,
        identityBaseUrl:
          normalizeOptionalString(env.EBAY_IDENTITY_BASE_URL) ?? defaultEbayIdentityBaseUrl,
        marketplaceId: normalizeOptionalString(env.EBAY_MARKETPLACE_ID) ?? defaultEbayMarketplaceId,
        oauthScope: normalizeOptionalString(env.EBAY_OAUTH_SCOPE) ?? defaultEbayOauthScope,
        affiliateCampaignId: normalizeOptionalString(env.EBAY_AFFILIATE_CAMPAIGN_ID),
        affiliateReferenceId: normalizeOptionalString(env.EBAY_AFFILIATE_REFERENCE_ID),
        requestTimeoutMs: parsePositiveInteger(env.EBAY_REQUEST_TIMEOUT_MS, 8_000, 1_000, 60_000),
        minRequestIntervalMs: parsePositiveInteger(
          env.EBAY_MIN_REQUEST_INTERVAL_MS,
          250,
          0,
          60_000,
        ),
        maxConcurrency: parsePositiveInteger(env.EBAY_MAX_CONCURRENCY, 2, 1, 10),
        maxRetries: parsePositiveInteger(env.EBAY_MAX_RETRIES, 2, 0, 5),
      },
    },
  };
}
