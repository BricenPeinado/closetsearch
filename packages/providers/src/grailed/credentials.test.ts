import { describe, expect, it } from "vitest";
import {
  createGrailedCredentialCache,
  extractGrailedAlgoliaCredentials,
  extractGrailedPublicConfigJson,
} from "./credentials";
import {
  grailedBrokenPublicConfigHtmlFixture,
  grailedPublicConfigHtmlFixture,
} from "./fixtures";

describe("Grailed credentials", () => {
  it("extracts the PUBLIC_CONFIG JSON block and Algolia credentials", () => {
    expect(extractGrailedPublicConfigJson(grailedPublicConfigHtmlFixture)).toContain(
      '"algolia"',
    );
    expect(extractGrailedAlgoliaCredentials(grailedPublicConfigHtmlFixture)).toEqual({
      appId: "grailed-app-123",
      apiKey: "grailed-key-123",
    });
  });

  it("throws clear errors when PUBLIC_CONFIG structure changes", () => {
    expect(() =>
      extractGrailedAlgoliaCredentials(grailedBrokenPublicConfigHtmlFixture),
    ).toThrow(/algolia configuration object/i);
    expect(() => extractGrailedPublicConfigJson("<html></html>")).toThrow(
      /PUBLIC_CONFIG was not found/i,
    );
  });

  it("expires cached credentials after the configured TTL", () => {
    let now = 0;
    const cache = createGrailedCredentialCache(1000, () => now);

    cache.set({
      appId: "grailed-app-123",
      apiKey: "grailed-key-123",
    });

    expect(cache.get()).toEqual({
      appId: "grailed-app-123",
      apiKey: "grailed-key-123",
    });

    now = 1001;
    expect(cache.get()).toBeUndefined();
  });
});
