import { describe, expect, it, vi } from "vitest";
import { createGrailedHttpClient } from "./http-client";

describe("createGrailedHttpClient", () => {
  it("applies conservative request pacing between calls", async () => {
    let now = 0;
    const slept: number[] = [];
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html></html>",
    });
    const client = createGrailedHttpClient({
      fetchImpl,
      minRequestIntervalMs: 3000,
      requestTimeoutMs: 5000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
      nowImpl: () => now,
      sleepImpl: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });

    await client.getHtml("https://www.grailed.com/shop?query=kapital");
    await client.getHtml("https://www.grailed.com/shop?query=kapital&page=2");

    expect(slept).toEqual([3000]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends a clear ClosetSearch user agent and optional contact header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html></html>",
    });
    const client = createGrailedHttpClient({
      fetchImpl,
      minRequestIntervalMs: 0,
      requestTimeoutMs: 5000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });

    await client.getHtml("https://www.grailed.com/shop?query=kapital");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://www.grailed.com/shop?query=kapital",
      expect.objectContaining({
        headers: expect.objectContaining({
          "user-agent": "ClosetSearchBot/0.1 contact:team@example.com",
          from: "team@example.com",
        }),
      }),
    );
  });

  it("can send paced JSON POST requests with browser-like headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });
    const client = createGrailedHttpClient({
      fetchImpl,
      minRequestIntervalMs: 0,
      requestTimeoutMs: 5000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });

    const response = await client.postJson<{ ok: boolean }>(
      "https://example-dsn.algolia.net/1/indexes/Listing_production/query",
      { params: "query=kapital" },
      {
        origin: "https://www.grailed.com",
        referer: "https://www.grailed.com/",
      },
    );

    expect(response.body).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example-dsn.algolia.net/1/indexes/Listing_production/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ params: "query=kapital" }),
        headers: expect.objectContaining({
          accept: "application/json",
          "content-type": "application/json",
          origin: "https://www.grailed.com",
          referer: "https://www.grailed.com/",
        }),
      }),
    );
  });
});
