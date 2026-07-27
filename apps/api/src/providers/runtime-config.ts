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
  locale?: string;
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
    depop: ProviderToggleConfig;
    ebay: ProviderToggleConfig;
    grailed: ProviderToggleConfig;
    mercariJp: ProviderToggleConfig;
    mock: ProviderToggleConfig;
    yahooAuctionsJp: ProviderToggleConfig;
  };
  requestTimeoutMs: number;
}

export type ProviderEnvironment = Record<string, string | undefined>;

const defaultProviderRuntimeMode: ProviderRuntimeMode = "mock";
const defaultRequestTimeoutMs = 10_000;
const defaultMaxProvidersPerRequest = 5;
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
const defaultProviderUserAgent = "ClosetSearchBot/1.0 contact:<project-contact-email>";

interface AuthorizedScrapingDefaults {
  baseUrl: string;
  circuitBreakerCooldownMs?: number;
  circuitBreakerFailureThreshold?: number;
  maxConcurrency?: number;
  maxResultsPerSearch?: number;
  maximumResultsPerSearch?: number;
  minRequestIntervalMs: number;
  requestTimeoutMs?: number;
}

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

function loadAuthorizedScrapingProvider(
  env: ProviderEnvironment,
  prefix: string,
  defaults: AuthorizedScrapingDefaults,
): ProviderToggleConfig {
  const baseUrl = normalizeOptionalString(env[`${prefix}_BASE_URL`]) ?? defaults.baseUrl;
  const userAgent =
    normalizeOptionalString(env[`${prefix}_USER_AGENT`]) ?? defaultProviderUserAgent;
  const scrapingAllowed = parseBooleanFlag(env[`${prefix}_SCRAPING_ALLOWED`], false);
  const authorizationReference = normalizeOptionalString(env[`${prefix}_AUTHORIZATION_REFERENCE`]);

  return {
    authorizationReference,
    baseBackoffMs: parsePositiveInteger(env[`${prefix}_BASE_BACKOFF_MS`], 250, 0, 10_000),
    baseUrl,
    circuitBreakerCooldownMs: parsePositiveInteger(
      env[`${prefix}_CIRCUIT_BREAKER_COOLDOWN_MS`],
      defaults.circuitBreakerCooldownMs ?? 30_000,
      1_000,
      300_000,
    ),
    circuitBreakerFailureThreshold: parsePositiveInteger(
      env[`${prefix}_CIRCUIT_BREAKER_FAILURE_THRESHOLD`],
      defaults.circuitBreakerFailureThreshold ?? 5,
      1,
      20,
    ),
    configured: Boolean(baseUrl && userAgent),
    enabled: parseBooleanFlag(env[`${prefix}_PROVIDER_ENABLED`], scrapingAllowed),
    maxConcurrency: parsePositiveInteger(
      env[`${prefix}_MAX_CONCURRENCY`],
      defaults.maxConcurrency ?? 2,
      1,
      10,
    ),
    maxRetries: parsePositiveInteger(env[`${prefix}_MAX_RETRIES`], 2, 0, 5),
    maxRetryAfterMs: parsePositiveInteger(env[`${prefix}_MAX_RETRY_AFTER_MS`], 60_000, 0, 300_000),
    maxResultsPerSearch: parsePositiveInteger(
      env[`${prefix}_MAX_RESULTS_PER_SEARCH`],
      defaults.maxResultsPerSearch ?? 48,
      1,
      defaults.maximumResultsPerSearch ?? 100,
    ),
    minRequestIntervalMs: parsePositiveInteger(
      env[`${prefix}_MIN_REQUEST_INTERVAL_MS`],
      defaults.minRequestIntervalMs,
      250,
      60_000,
    ),
    requestTimeoutMs: parsePositiveInteger(
      env[`${prefix}_REQUEST_TIMEOUT_MS`],
      defaults.requestTimeoutMs ?? 8_000,
      1_000,
      60_000,
    ),
    scrapingAllowed,
    userAgent,
  };
}

export function loadProviderRuntimeConfig(
  env: ProviderEnvironment = process.env,
): ProviderRuntimeConfig {
  const grailed = loadAuthorizedScrapingProvider(env, "GRAILED", {
    baseUrl: defaultGrailedBaseUrl,
    requestTimeoutMs: defaultGrailedRequestTimeoutMs,
    minRequestIntervalMs: defaultGrailedMinRequestIntervalMs,
    maxResultsPerSearch: defaultGrailedMaxResultsPerSearch,
    maximumResultsPerSearch: 100,
    maxConcurrency: defaultGrailedMaxConcurrency,
    circuitBreakerFailureThreshold: defaultGrailedCircuitBreakerFailureThreshold,
    circuitBreakerCooldownMs: defaultGrailedCircuitBreakerCooldownMs,
  });
  grailed.userAgent = normalizeOptionalString(env.GRAILED_USER_AGENT) ?? defaultGrailedUserAgent;
  grailed.baseBackoffMs = parsePositiveInteger(
    env.GRAILED_BASE_BACKOFF_MS,
    defaultGrailedBaseBackoffMs,
    0,
    10_000,
  );
  grailed.maxRetries = parsePositiveInteger(
    env.GRAILED_MAX_RETRIES,
    defaultGrailedMaxRetries,
    0,
    5,
  );
  grailed.maxRetryAfterMs = parsePositiveInteger(
    env.GRAILED_MAX_RETRY_AFTER_MS,
    defaultGrailedMaxRetryAfterMs,
    0,
    300_000,
  );
  const ebayClientId = normalizeOptionalString(env.EBAY_CLIENT_ID);
  const ebayClientSecret = normalizeOptionalString(env.EBAY_CLIENT_SECRET);
  const ebayEnabled = parseBooleanFlag(env.EBAY_PROVIDER_ENABLED, false);
  const ebayAuthorizationReference = normalizeOptionalString(env.EBAY_AUTHORIZATION_REFERENCE);
  const depop = loadAuthorizedScrapingProvider(env, "DEPOP", {
    baseUrl: "https://webapi.depop.com",
    maximumResultsPerSearch: 100,
    minRequestIntervalMs: 2_000,
  });
  const yahooAuctionsJp = loadAuthorizedScrapingProvider(env, "YAHOO_AUCTIONS_JP", {
    baseUrl: "https://auctions.yahoo.co.jp",
    maximumResultsPerSearch: 100,
    minRequestIntervalMs: 2_500,
  });
  const mercariJp = loadAuthorizedScrapingProvider(env, "MERCARI_JP", {
    baseUrl: "https://api.mercari.jp",
    maximumResultsPerSearch: 120,
    minRequestIntervalMs: 2_500,
  });
  const isProduction = env.NODE_ENV?.trim().toLowerCase() === "production";
  const hasAuthorizedRealProvider =
    [grailed, depop, yahooAuctionsJp, mercariJp].some(
      (provider) =>
        provider.enabled &&
        provider.scrapingAllowed === true &&
        Boolean(provider.authorizationReference),
    ) ||
    (ebayEnabled && Boolean(ebayClientId && ebayClientSecret && ebayAuthorizationReference));
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
      depop,
      grailed,
      mercariJp,
      yahooAuctionsJp,
      ebay: {
        enabled: ebayEnabled,
        configured: Boolean(ebayClientId && ebayClientSecret),
        authorizationReference: ebayAuthorizationReference,
        clientId: ebayClientId,
        clientSecret: ebayClientSecret,
        apiBaseUrl: normalizeOptionalString(env.EBAY_API_BASE_URL) ?? defaultEbayApiBaseUrl,
        identityBaseUrl:
          normalizeOptionalString(env.EBAY_IDENTITY_BASE_URL) ?? defaultEbayIdentityBaseUrl,
        marketplaceId: normalizeOptionalString(env.EBAY_MARKETPLACE_ID) ?? defaultEbayMarketplaceId,
        locale: normalizeOptionalString(env.EBAY_LOCALE) ?? "en-US",
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
