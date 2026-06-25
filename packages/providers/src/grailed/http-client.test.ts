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
});
