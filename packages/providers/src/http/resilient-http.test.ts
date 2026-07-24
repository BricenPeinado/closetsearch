import { describe, expect, it, vi } from "vitest";
import {
  createResilientHttpClient,
  parseRetryAfterMs,
  ProviderHttpError,
} from "./resilient-http.js";

function response(
  status: number,
  body = "{}",
  retryAfter?: string,
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "retry-after" ? retryAfter ?? null : null;
      },
    },
    async text() {
      return body;
    },
  };
}

describe("parseRetryAfterMs", () => {
  it("supports seconds and HTTP dates", () => {
    expect(parseRetryAfterMs("1.5", 0)).toBe(1_500);
    expect(parseRetryAfterMs("Thu, 01 Jan 1970 00:00:03 GMT", 1_000)).toBe(
      2_000,
    );
  });
});

describe("createResilientHttpClient", () => {
  it("honors Retry-After before retrying a rate-limited request", async () => {
    const slept: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(429, "{}", "2"))
      .mockResolvedValueOnce(response(200));
    const client = createResilientHttpClient({
      fetchImpl,
      maxRetries: 1,
      minRequestIntervalMs: 0,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });

    await expect(
      client.request({
        operation: "fixture_search",
        url: "https://api.example.test/search",
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(slept).toEqual([2_000]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("bounds concurrent requests", async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const fetchImpl = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return response(200);
    });
    const client = createResilientHttpClient({
      fetchImpl,
      maxConcurrency: 1,
      maxRetries: 0,
    });
    const first = client.request({
      operation: "first",
      url: "https://api.example.test/first",
    });
    const second = client.request({
      operation: "second",
      url: "https://api.example.test/second",
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    releases.shift()?.();
    await Promise.all([first, second]);

    expect(maximumActive).toBe(1);
  });

  it("opens a circuit after bounded retryable failures", async () => {
    let now = 0;
    const fetchImpl = vi.fn().mockResolvedValue(response(503));
    const client = createResilientHttpClient({
      circuitBreakerCooldownMs: 1_000,
      circuitBreakerFailureThreshold: 2,
      fetchImpl,
      maxRetries: 0,
      nowImpl: () => now,
    });
    const call = () =>
      client.request({
        operation: "fixture_search",
        url: "https://api.example.test/search",
      });

    await expect(call()).rejects.toBeInstanceOf(ProviderHttpError);
    await expect(call()).rejects.toBeInstanceOf(ProviderHttpError);
    expect(client.getCircuitState()).toBe("open");
    await expect(call()).rejects.toMatchObject({ code: "circuit_open" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now = 1_000;
    fetchImpl.mockResolvedValueOnce(response(200));
    await expect(call()).resolves.toMatchObject({ status: 200 });
    expect(client.getCircuitState()).toBe("closed");
  });
});
