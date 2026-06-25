import { describe, expect, it, vi } from "vitest";
import {
  grailedNoResultsHtmlFixture,
  grailedSearchHtmlFixture,
} from "./fixtures";
import { createGrailedProvider } from "./provider";

describe("createGrailedProvider", () => {
  it("uses local fixtures by default and does not make live network calls", async () => {
    const fetchImpl = vi.fn();
    const provider = createGrailedProvider({ fetchImpl });
    const response = await provider.search({ text: "kapital", sort: "newest" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("Expected Grailed fixture mode to return a success response.");
    }

    expect(response.listings).toHaveLength(1);
    expect(response.listings[0]).toMatchObject({
      providerId: "grailed",
      title: "Kapital ring coat",
      brand: { slug: "kapital" },
    });
  });

  it("does not scrape unless authorization is explicitly enabled", async () => {
    const fetchImpl = vi.fn();
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      fetchImpl,
      scrapingAllowed: false,
    });
    const response = await provider.search({ text: "kapital" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(response).toEqual({
      providerId: "grailed",
      status: "failure",
      failure: {
        providerId: "grailed",
        code: "authorization_required",
        message:
          "Grailed scraping is not allowed until GRAILED_SCRAPING_ALLOWED=true is set with documented written permission.",
        retryable: false,
      },
    });
  });

  it("builds a public Grailed search request and normalizes fixture HTML into shared listings", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => grailedSearchHtmlFixture,
    });
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      fetchImpl,
      scrapingAllowed: true,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });
    const response = await provider.search({
      text: "kapital",
      page: 2,
      pageSize: 1,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://www.grailed.com/shop?query=kapital&page=2",
      expect.objectContaining({
        headers: expect.objectContaining({
          "user-agent": "ClosetSearchBot/0.1 contact:team@example.com",
          from: "team@example.com",
        }),
      }),
    );
    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("Expected authorized-live response to succeed.");
    }

    expect(response.listings).toHaveLength(1);
    expect(response.listings[0]).toMatchObject({
      providerId: "grailed",
      sourceUrl: "https://www.grailed.com/listings/grailed-1001-kapital-ring-coat",
      title: "Kapital ring coat",
      brand: { slug: "kapital" },
      imageUrl: "https://media.example.com/grailed-1001.jpg",
      price: { amount: 325, currency: "USD" },
    });
    expect(response.listings[0]).not.toHaveProperty("rawHtml");
  });

  it("returns an empty success response when the public page shows no results", async () => {
    const provider = createGrailedProvider({
      runtimeMode: "authorized-live",
      scrapingAllowed: true,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => grailedNoResultsHtmlFixture,
      }),
    });
    const response = await provider.search({ text: "nonexistent archive piece" });

    expect(response).toMatchObject({
      providerId: "grailed",
      status: "success",
      listings: [],
      hasMore: false,
    });
  });

  it("returns recoverable failures for rate limits and timeouts", async () => {
    const rateLimitedProvider = createGrailedProvider({
      runtimeMode: "authorized-live",
      scrapingAllowed: true,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      }),
    });
    const timeoutError = new Error("Timed out");
    timeoutError.name = "AbortError";
    const timeoutProvider = createGrailedProvider({
      runtimeMode: "authorized-live",
      scrapingAllowed: true,
      fetchImpl: vi.fn().mockRejectedValue(timeoutError),
    });

    await expect(rateLimitedProvider.search({ text: "kapital" })).resolves.toEqual({
      providerId: "grailed",
      status: "failure",
      failure: {
        providerId: "grailed",
        code: "rate_limited",
        message: "Grailed returned a rate-limit response. Back off before retrying.",
        retryable: true,
      },
    });

    await expect(timeoutProvider.search({ text: "kapital" })).resolves.toEqual({
      providerId: "grailed",
      status: "failure",
      failure: {
        providerId: "grailed",
        code: "timeout",
        message: "Grailed scraping request timed out.",
        retryable: true,
      },
    });
  });
});
