import {
  createResilientHttpClient,
  type ProviderFetch,
  type ProviderHttpMetric,
} from "../http/resilient-http.js";

export interface GrailedHttpClientResponse {
  body: string;
  ok: boolean;
  status: number;
}

export interface GrailedJsonClientResponse<T> {
  body: T;
  ok: boolean;
  status: number;
}

export type GrailedFetch = ProviderFetch;

export interface GrailedHttpClientOptions {
  baseBackoffMs?: number;
  circuitBreakerCooldownMs?: number;
  circuitBreakerFailureThreshold?: number;
  fetchImpl: GrailedFetch;
  maxConcurrency?: number;
  maxRetries?: number;
  maxRetryAfterMs?: number;
  minRequestIntervalMs: number;
  onHttpMetric?: (metric: ProviderHttpMetric) => void;
  requestTimeoutMs: number;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  userAgent: string;
}

export interface GrailedHttpClient {
  getHtml(url: string): Promise<GrailedHttpClientResponse>;
  getText(url: string, headers?: Record<string, string>): Promise<GrailedHttpClientResponse>;
  postJson<T>(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<GrailedJsonClientResponse<T>>;
}

function extractContactEmail(userAgent: string) {
  const match = userAgent.match(/contact:([^\s>]+)/i);
  return match?.[1];
}

function createBaseHeaders(userAgent: string) {
  const fromHeader = extractContactEmail(userAgent);

  return {
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent": userAgent,
    ...(fromHeader ? { from: fromHeader } : {}),
  };
}

export function createGrailedHttpClient(options: GrailedHttpClientOptions): GrailedHttpClient {
  const resilientClient = createResilientHttpClient({
    baseBackoffMs: options.baseBackoffMs,
    circuitBreakerCooldownMs: options.circuitBreakerCooldownMs,
    circuitBreakerFailureThreshold: options.circuitBreakerFailureThreshold,
    fetchImpl: options.fetchImpl,
    maxConcurrency: options.maxConcurrency,
    maxRetries: options.maxRetries,
    maxRetryAfterMs: options.maxRetryAfterMs,
    minRequestIntervalMs: options.minRequestIntervalMs,
    nowImpl: options.nowImpl,
    onMetric: options.onHttpMetric,
    requestTimeoutMs: options.requestTimeoutMs,
    sleepImpl: options.sleepImpl,
  });

  async function requestText(
    url: string,
    init: {
      body?: string;
      headers?: Record<string, string>;
      method?: string;
      operation: string;
    },
  ) {
    const response = await resilientClient.request({
      body: init.body,
      method: init.method,
      operation: init.operation,
      url,
      headers: {
        ...createBaseHeaders(options.userAgent),
        ...init.headers,
      },
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    } satisfies GrailedHttpClientResponse;
  }

  return {
    getHtml(url: string): Promise<GrailedHttpClientResponse> {
      return requestText(url, {
        operation: "credential_html",
        headers: {
          accept: "text/html,application/xhtml+xml",
          connection: "keep-alive",
          "upgrade-insecure-requests": "1",
        },
      });
    },
    getText(url: string, headers: Record<string, string> = {}): Promise<GrailedHttpClientResponse> {
      return requestText(url, {
        operation: "credential_asset",
        headers: {
          accept: "*/*",
          connection: "keep-alive",
          ...headers,
        },
      });
    },
    async postJson<T>(
      url: string,
      body: unknown,
      headers: Record<string, string> = {},
    ): Promise<GrailedJsonClientResponse<T>> {
      const response = await requestText(url, {
        body: JSON.stringify(body),
        method: "POST",
        operation: "algolia_query",
        headers: {
          accept: "application/json",
          connection: "keep-alive",
          "content-type": "application/json",
          ...headers,
        },
      });

      return {
        ok: response.ok,
        status: response.status,
        body: JSON.parse(response.body) as T,
      } satisfies GrailedJsonClientResponse<T>;
    },
  };
}
