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

export interface GrailedFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type GrailedFetch = (
  input: string,
  init?: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortSignal;
  },
) => Promise<GrailedFetchResponse>;

export interface GrailedHttpClientOptions {
  fetchImpl: GrailedFetch;
  minRequestIntervalMs: number;
  requestTimeoutMs: number;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  userAgent: string;
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

export function createGrailedHttpClient(options: GrailedHttpClientOptions) {
  let nextAllowedRequestAt = 0;
  const sleepImpl =
    options.sleepImpl ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const nowImpl = options.nowImpl ?? (() => Date.now());

  async function requestText(
    url: string,
    init: {
      body?: string;
      headers?: Record<string, string>;
      method?: string;
    } = {},
  ) {
    const waitMs = Math.max(0, nextAllowedRequestAt - nowImpl());

    if (waitMs > 0) {
      await sleepImpl(waitMs);
    }

    nextAllowedRequestAt = nowImpl() + options.minRequestIntervalMs;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.requestTimeoutMs);

    try {
      const response = await options.fetchImpl(url, {
        body: init.body,
        method: init.method,
        headers: {
          ...createBaseHeaders(options.userAgent),
          ...init.headers,
        },
        signal: controller.signal,
      });

      return {
        ok: response.ok,
        status: response.status,
        body: await response.text(),
      } satisfies GrailedHttpClientResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    getHtml(url: string): Promise<GrailedHttpClientResponse> {
      return requestText(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          connection: "keep-alive",
          "upgrade-insecure-requests": "1",
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
