export interface GrailedHttpClientResponse {
  body: string;
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
    headers?: Record<string, string>;
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

export function createGrailedHttpClient(options: GrailedHttpClientOptions) {
  let nextAllowedRequestAt = 0;
  const sleepImpl = options.sleepImpl ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const nowImpl = options.nowImpl ?? (() => Date.now());

  return {
    async getHtml(url: string): Promise<GrailedHttpClientResponse> {
      const waitMs = Math.max(0, nextAllowedRequestAt - nowImpl());

      if (waitMs > 0) {
        await sleepImpl(waitMs);
      }

      nextAllowedRequestAt = nowImpl() + options.minRequestIntervalMs;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.requestTimeoutMs);
      const fromHeader = extractContactEmail(options.userAgent);

      try {
        const response = await options.fetchImpl(url, {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": options.userAgent,
            ...(fromHeader ? { from: fromHeader } : {}),
          },
          signal: controller.signal,
        });

        return {
          ok: response.ok,
          status: response.status,
          body: await response.text(),
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
