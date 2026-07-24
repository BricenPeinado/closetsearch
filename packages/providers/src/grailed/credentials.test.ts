import { describe, expect, it, vi } from "vitest";
import { createGrailedHttpClient } from "./http-client";
import {
  createGrailedCredentialCache,
  extractGrailedAlgoliaCredentials,
  extractGrailedPublicConfigJson,
  GrailedCredentialResolutionError,
  resolveGrailedAlgoliaCredentials,
} from "./credentials";
import {
  grailedAlternateInlineConfigHtmlFixture,
  grailedBrokenPublicConfigHtmlFixture,
  grailedCredentialBundleFixture,
  grailedHomepageScriptHtmlFixture,
  grailedPublicConfigHtmlFixture,
} from "./fixtures";

function createTextResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

function createJsonResponse(status: number, body: unknown) {
  return createTextResponse(status, JSON.stringify(body));
}

describe("Grailed credentials", () => {
  it("extracts the PUBLIC_CONFIG JSON block and Algolia credentials", () => {
    expect(extractGrailedPublicConfigJson(grailedPublicConfigHtmlFixture)).toContain('"algolia"');
    expect(extractGrailedAlgoliaCredentials(grailedPublicConfigHtmlFixture)).toEqual({
      appId: "GRAILED123",
      apiKey: "grailed-key-123",
    });
  });

  it("throws clear errors when PUBLIC_CONFIG structure changes", () => {
    expect(() => extractGrailedAlgoliaCredentials(grailedBrokenPublicConfigHtmlFixture)).toThrow(
      /algolia configuration object/i,
    );
    expect(() => extractGrailedPublicConfigJson("<html></html>")).toThrow(
      /PUBLIC_CONFIG was not found/i,
    );
  });

  it("rejects host-injecting Algolia application identifiers before networking", async () => {
    const maliciousHtml = grailedPublicConfigHtmlFixture.replace(
      "GRAILED123",
      "127.0.0.1:4443/internal",
    );
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === "https://www.grailed.com") {
        return createTextResponse(200, maliciousHtml);
      }

      throw new Error(`Unexpected URL: ${input}`);
    });
    const client = createGrailedHttpClient({
      fetchImpl,
      minRequestIntervalMs: 0,
      requestTimeoutMs: 1_000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });

    await expect(
      resolveGrailedAlgoliaCredentials({
        baseUrl: "https://www.grailed.com",
        cache: createGrailedCredentialCache(60_000),
        client,
      }),
    ).rejects.toThrow(/invalid Algolia application identifier/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ignores cross-origin script bundles during credential discovery", async () => {
    const maliciousHtml =
      '<html><script src="http://127.0.0.1:4444/internal/admin"></script></html>';
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === "https://www.grailed.com") {
        return createTextResponse(200, maliciousHtml);
      }

      throw new Error(`Unexpected URL: ${input}`);
    });
    const client = createGrailedHttpClient({
      fetchImpl,
      minRequestIntervalMs: 0,
      requestTimeoutMs: 1_000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });

    await expect(
      resolveGrailedAlgoliaCredentials({
        baseUrl: "https://www.grailed.com",
        cache: createGrailedCredentialCache(60_000),
        client,
      }),
    ).rejects.toMatchObject({
      code: "missing_credentials",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining("127.0.0.1"),
      expect.anything(),
    );
  });

  it("resolves credentials from the existing PUBLIC_CONFIG inline config", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === "https://www.grailed.com") {
        return createTextResponse(200, grailedPublicConfigHtmlFixture);
      }

      if (input.includes("algolia.net/1/indexes/Listing_production/query")) {
        return createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        });
      }

      throw new Error(`Unexpected URL: ${input}`);
    });
    const client = createGrailedHttpClient({
      fetchImpl,
      minRequestIntervalMs: 0,
      requestTimeoutMs: 1_000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });
    const cache = createGrailedCredentialCache(60_000);

    await expect(
      resolveGrailedAlgoliaCredentials({
        baseUrl: "https://www.grailed.com",
        cache,
        client,
      }),
    ).resolves.toEqual({
      appId: "GRAILED123",
      apiKey: "grailed-key-123",
    });
  });

  it("resolves credentials from an alternate inline JSON shape", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === "https://www.grailed.com") {
        return createTextResponse(200, grailedAlternateInlineConfigHtmlFixture);
      }

      if (input.includes("algolia.net/1/indexes/Listing_production/query")) {
        return createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        });
      }

      throw new Error(`Unexpected URL: ${input}`);
    });
    const client = createGrailedHttpClient({
      fetchImpl,
      minRequestIntervalMs: 0,
      requestTimeoutMs: 1_000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });
    const cache = createGrailedCredentialCache(60_000);

    await expect(
      resolveGrailedAlgoliaCredentials({
        baseUrl: "https://www.grailed.com",
        cache,
        client,
      }),
    ).resolves.toEqual({
      appId: "GRAILED234",
      apiKey: "grailed-key-234",
    });
  });

  it("resolves credentials from a mocked script bundle", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === "https://www.grailed.com") {
        return createTextResponse(200, grailedHomepageScriptHtmlFixture);
      }

      if (input === "https://www.grailed.com/assets/runtime.js") {
        return createTextResponse(200, "window.__runtime=true;");
      }

      if (input === "https://www.grailed.com/assets/listings.js") {
        return createTextResponse(200, grailedCredentialBundleFixture);
      }

      if (input.includes("algolia.net/1/indexes/Listing_production/query")) {
        return createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        });
      }

      throw new Error(`Unexpected URL: ${input}`);
    });
    const client = createGrailedHttpClient({
      fetchImpl,
      minRequestIntervalMs: 0,
      requestTimeoutMs: 1_000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });
    const cache = createGrailedCredentialCache(60_000);

    await expect(
      resolveGrailedAlgoliaCredentials({
        baseUrl: "https://www.grailed.com",
        cache,
        client,
      }),
    ).resolves.toEqual({
      appId: "GRAILED456",
      apiKey: "grailed-key-456",
    });
  });

  it("rejects invalid credentials when validation returns 401 or 403", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === "https://www.grailed.com") {
        return createTextResponse(200, grailedPublicConfigHtmlFixture);
      }

      if (input.includes("algolia.net/1/indexes/Listing_production/query")) {
        return createJsonResponse(401, { message: "invalid credentials" });
      }

      throw new Error(`Unexpected URL: ${input}`);
    });
    const client = createGrailedHttpClient({
      fetchImpl,
      minRequestIntervalMs: 0,
      requestTimeoutMs: 1_000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });
    const cache = createGrailedCredentialCache(60_000);

    await expect(
      resolveGrailedAlgoliaCredentials({
        baseUrl: "https://www.grailed.com",
        cache,
        client,
      }),
    ).rejects.toMatchObject({
      code: "missing_credentials",
      message: expect.stringContaining("validation failed"),
    } satisfies Partial<GrailedCredentialResolutionError>);
  });

  it("reuses cached credentials after they validate", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === "https://www.grailed.com") {
        return createTextResponse(200, grailedPublicConfigHtmlFixture);
      }

      if (input.includes("algolia.net/1/indexes/Listing_production/query")) {
        return createJsonResponse(200, {
          hits: [],
          hitsPerPage: 1,
          nbHits: 0,
          nbPages: 0,
          page: 0,
        });
      }

      throw new Error(`Unexpected URL: ${input}`);
    });
    const client = createGrailedHttpClient({
      fetchImpl,
      minRequestIntervalMs: 0,
      requestTimeoutMs: 1_000,
      userAgent: "ClosetSearchBot/0.1 contact:team@example.com",
    });
    const cache = createGrailedCredentialCache(60_000);

    await resolveGrailedAlgoliaCredentials({
      baseUrl: "https://www.grailed.com",
      cache,
      client,
    });
    await resolveGrailedAlgoliaCredentials({
      baseUrl: "https://www.grailed.com",
      cache,
      client,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://www.grailed.com", expect.any(Object));
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("algolia.net/1/indexes/Listing_production/query"),
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("algolia.net/1/indexes/Listing_production/query"),
      expect.any(Object),
    );
  });

  it("expires cached credentials after the configured TTL", () => {
    let now = 0;
    const cache = createGrailedCredentialCache(1000, () => now);

    cache.set({
      appId: "GRAILED123",
      apiKey: "grailed-key-123",
    });

    expect(cache.get()).toEqual({
      appId: "GRAILED123",
      apiKey: "grailed-key-123",
    });

    now = 1001;
    expect(cache.get()).toBeUndefined();
  });
});
