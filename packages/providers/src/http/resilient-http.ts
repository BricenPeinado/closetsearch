import type { ProviderFailureCode } from "../types.js";

export interface ProviderHttpHeaders {
  get(name: string): string | null;
}

export interface ProviderHttpResponse {
  headers?: ProviderHttpHeaders;
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type ProviderFetch = (
  input: string,
  init?: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortSignal;
  },
) => Promise<ProviderHttpResponse>;

export interface ProviderHttpMetric {
  attempts: number;
  circuitState: "closed" | "half_open" | "open";
  latencyMs: number;
  operation: string;
  outcome: "success" | "failure";
  retryable: boolean;
  statusCode?: number;
}

export interface ResilientHttpClientOptions {
  baseBackoffMs?: number;
  circuitBreakerCooldownMs?: number;
  circuitBreakerFailureThreshold?: number;
  fetchImpl: ProviderFetch;
  maxConcurrency?: number;
  maxRetries?: number;
  maxRetryAfterMs?: number;
  minRequestIntervalMs?: number;
  nowImpl?: () => number;
  onMetric?: (metric: ProviderHttpMetric) => void;
  requestTimeoutMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface ProviderHttpRequest {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
  operation: string;
  retryableStatuses?: number[];
  url: string;
}

export class ProviderHttpError extends Error {
  readonly code: ProviderFailureCode;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      code: ProviderFailureCode;
      retryAfterMs?: number;
      retryable: boolean;
      statusCode?: number;
    },
  ) {
    super(message);
    this.name = "ProviderHttpError";
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

const defaultRetryableStatuses = [408, 425, 429, 500, 502, 503, 504];

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  minimum = 0,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.trunc(value));
}

export function parseRetryAfterMs(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return undefined;
  }

  if (/^\d+(?:\.\d+)?$/.test(normalizedValue)) {
    return Math.max(0, Math.ceil(Number(normalizedValue) * 1_000));
  }

  const retryAt = new Date(normalizedValue).valueOf();
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now);
}

export function createResilientHttpClient(options: ResilientHttpClientOptions) {
  const requestTimeoutMs = normalizePositiveInteger(
    options.requestTimeoutMs,
    10_000,
    1,
  );
  const maxRetries = normalizePositiveInteger(options.maxRetries, 2);
  const baseBackoffMs = normalizePositiveInteger(options.baseBackoffMs, 250);
  const minRequestIntervalMs = normalizePositiveInteger(
    options.minRequestIntervalMs,
    0,
  );
  const maxRetryAfterMs = normalizePositiveInteger(
    options.maxRetryAfterMs,
    60_000,
  );
  const maxConcurrency = normalizePositiveInteger(options.maxConcurrency, 2, 1);
  const circuitBreakerFailureThreshold = normalizePositiveInteger(
    options.circuitBreakerFailureThreshold,
    5,
    1,
  );
  const circuitBreakerCooldownMs = normalizePositiveInteger(
    options.circuitBreakerCooldownMs,
    30_000,
    1,
  );
  const nowImpl = options.nowImpl ?? (() => Date.now());
  const sleepImpl =
    options.sleepImpl ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let activeRequests = 0;
  const concurrencyQueue: Array<() => void> = [];
  let nextAllowedRequestAt = 0;
  let pacingTail = Promise.resolve();
  let consecutiveFailures = 0;
  let circuitOpenedAt: number | undefined;
  let halfOpenRequestActive = false;

  function getCircuitState(): ProviderHttpMetric["circuitState"] {
    if (circuitOpenedAt === undefined) {
      return "closed";
    }

    return nowImpl() - circuitOpenedAt >= circuitBreakerCooldownMs
      ? "half_open"
      : "open";
  }

  async function acquireConcurrencySlot() {
    if (activeRequests < maxConcurrency) {
      activeRequests += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      concurrencyQueue.push(resolve);
    });
  }

  function releaseConcurrencySlot() {
    const nextRequest = concurrencyQueue.shift();

    if (nextRequest) {
      nextRequest();
      return;
    }

    activeRequests = Math.max(0, activeRequests - 1);
  }

  async function paceRequest() {
    let releasePacingLock: (() => void) | undefined;
    const previousTail = pacingTail;
    pacingTail = new Promise<void>((resolve) => {
      releasePacingLock = resolve;
    });
    await previousTail;

    try {
      const waitMs = Math.max(0, nextAllowedRequestAt - nowImpl());

      if (waitMs > 0) {
        await sleepImpl(waitMs);
      }

      nextAllowedRequestAt = nowImpl() + minRequestIntervalMs;
    } finally {
      releasePacingLock?.();
    }
  }

  function beforeRequest() {
    const state = getCircuitState();

    if (state === "open") {
      const retryAfterMs = Math.max(
        0,
        circuitBreakerCooldownMs - (nowImpl() - (circuitOpenedAt ?? nowImpl())),
      );
      throw new ProviderHttpError(
        "Provider circuit breaker is open after repeated retryable failures.",
        {
          code: "circuit_open",
          retryable: true,
          retryAfterMs,
        },
      );
    }

    if (state === "half_open") {
      if (halfOpenRequestActive) {
        throw new ProviderHttpError(
          "Provider circuit breaker is testing recovery with another request.",
          {
            code: "circuit_open",
            retryable: true,
            retryAfterMs: circuitBreakerCooldownMs,
          },
        );
      }

      halfOpenRequestActive = true;
    }
  }

  function recordSuccess() {
    consecutiveFailures = 0;
    circuitOpenedAt = undefined;
    halfOpenRequestActive = false;
  }

  function recordRetryableFailure() {
    consecutiveFailures += 1;
    halfOpenRequestActive = false;

    if (consecutiveFailures >= circuitBreakerFailureThreshold) {
      circuitOpenedAt = nowImpl();
    }
  }

  async function fetchOnce(request: ProviderHttpRequest) {
    await acquireConcurrencySlot();

    try {
      await paceRequest();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      try {
        return await options.fetchImpl(request.url, {
          body: request.body,
          headers: request.headers,
          method: request.method,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } finally {
      releaseConcurrencySlot();
    }
  }

  async function request(
    requestOptions: ProviderHttpRequest,
  ): Promise<ProviderHttpResponse> {
    const startedAt = nowImpl();
    let attempts = 0;
    let lastError: ProviderHttpError | undefined;
    let metricCircuitState: ProviderHttpMetric["circuitState"] = getCircuitState();

    try {
      beforeRequest();
      metricCircuitState = getCircuitState();

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        attempts = attempt + 1;

        try {
          const response = await fetchOnce(requestOptions);
          const retryableStatuses =
            requestOptions.retryableStatuses ?? defaultRetryableStatuses;

          if (!retryableStatuses.includes(response.status)) {
            recordSuccess();
            options.onMetric?.({
              attempts,
              circuitState: metricCircuitState,
              latencyMs: Math.max(0, nowImpl() - startedAt),
              operation: requestOptions.operation,
              outcome: response.ok ? "success" : "failure",
              retryable: false,
              statusCode: response.status,
            });
            return response;
          }

          const retryAfterMs = Math.min(
            maxRetryAfterMs,
            parseRetryAfterMs(
              response.headers?.get("retry-after"),
              nowImpl(),
            ) ?? baseBackoffMs * 2 ** attempt,
          );
          lastError = new ProviderHttpError(
            `Provider HTTP request failed with retryable status ${response.status}.`,
            {
              code: response.status === 429 ? "rate_limited" : "unavailable",
              retryable: true,
              retryAfterMs,
              statusCode: response.status,
            },
          );

          if (attempt < maxRetries) {
            await sleepImpl(retryAfterMs);
            continue;
          }
        } catch (error) {
          if (error instanceof ProviderHttpError) {
            lastError = error;
          } else {
            const timedOut =
              error instanceof Error && error.name === "AbortError";
            lastError = new ProviderHttpError(
              timedOut
                ? "Provider HTTP request timed out."
                : "Provider HTTP request failed before receiving a response.",
              {
                code: timedOut ? "timeout" : "unavailable",
                retryable: true,
              },
            );
          }

          if (attempt < maxRetries) {
            await sleepImpl(baseBackoffMs * 2 ** attempt);
            continue;
          }
        }
      }

      recordRetryableFailure();
      throw (
        lastError ??
        new ProviderHttpError("Provider HTTP request failed.", {
          code: "unknown",
          retryable: true,
        })
      );
    } catch (error) {
      const normalizedError =
        error instanceof ProviderHttpError
          ? error
          : new ProviderHttpError("Provider HTTP request failed.", {
              code: "unknown",
              retryable: false,
            });
      options.onMetric?.({
        attempts,
        circuitState: getCircuitState(),
        latencyMs: Math.max(0, nowImpl() - startedAt),
        operation: requestOptions.operation,
        outcome: "failure",
        retryable: normalizedError.retryable,
        statusCode: normalizedError.statusCode,
      });
      throw normalizedError;
    }
  }

  return {
    getCircuitState,
    request,
  };
}
