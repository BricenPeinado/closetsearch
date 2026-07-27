import { describe, expect, it } from "vitest";
import { createProviderRuntime } from "./registry.js";
import { loadProviderRuntimeConfig } from "./runtime-config.js";

describe("createProviderRuntime", () => {
  it("keeps the mock provider active by default", () => {
    const runtime = createProviderRuntime(loadProviderRuntimeConfig({}));

    expect(runtime.activeProviders.map((registration) => registration.provider.id)).toEqual([
      "mock",
    ]);
    expect(runtime.preflightFailures).toEqual([]);
    expect(runtime.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mock",
          providerMode: "mock",
          mode: "fixture",
          active: true,
        }),
        expect.objectContaining({
          id: "grailed",
          providerMode: "real",
          mode: "disabled",
          enabled: false,
          scrapingAllowed: false,
        }),
      ]),
    );
  });

  it("auto-activates Grailed as the default authorized provider when scraping is authorized", () => {
    const runtime = createProviderRuntime(
      loadProviderRuntimeConfig({
        GRAILED_SCRAPING_ALLOWED: "true",
        GRAILED_AUTHORIZATION_REFERENCE: "agreement-2026-01",
        GRAILED_USER_AGENT: "ClosetSearchBot/0.1 contact:team@example.com",
      }),
    );

    expect(runtime.config.mode).toBe("real");
    expect(runtime.activeProviders.map((registration) => registration.provider.id)).toEqual([
      "grailed",
    ]);

    const grailedStatus = runtime.statuses.find((status) => status.id === "grailed");

    expect(grailedStatus).toMatchObject({
      active: true,
      enabled: true,
      configured: true,
      mode: "authorized-live",
      scrapingAllowed: true,
    });
  });

  it("skips enabled Grailed scraping until authorization is enabled and falls back to mock in real mode", () => {
    const runtime = createProviderRuntime(
      loadProviderRuntimeConfig({
        PROVIDER_RUNTIME_MODE: "real",
        GRAILED_PROVIDER_ENABLED: "true",
      }),
    );

    expect(runtime.activeProviders.map((registration) => registration.provider.id)).toEqual([
      "mock",
    ]);
    expect(runtime.preflightFailures).toHaveLength(1);
    expect(runtime.preflightFailures[0]).toMatchObject({
      providerId: "grailed",
      failure: { code: "authorization_required" },
    });

    const mockStatus = runtime.statuses.find((status) => status.id === "mock");
    const grailedStatus = runtime.statuses.find((status) => status.id === "grailed");

    expect(mockStatus).toMatchObject({
      active: true,
      enabled: true,
      mode: "fixture",
    });
    expect(mockStatus?.reasons).toContain("mock_fallback");
    expect(grailedStatus).toMatchObject({
      active: false,
      enabled: true,
      configured: true,
      mode: "disabled",
      scrapingAllowed: false,
      lastErrorCategory: "authorization_required",
    });
    expect(grailedStatus?.reasons).toContain("scraping_not_authorized");
  });

  it("fails closed for every enabled real provider without its retained authorization reference", () => {
    const cases = [
      {
        id: "grailed",
        env: {
          GRAILED_PROVIDER_ENABLED: "true",
          GRAILED_SCRAPING_ALLOWED: "true",
        },
      },
      {
        id: "depop",
        env: {
          DEPOP_PROVIDER_ENABLED: "true",
          DEPOP_SCRAPING_ALLOWED: "true",
        },
      },
      {
        id: "yahoo-auctions-jp",
        env: {
          YAHOO_AUCTIONS_JP_PROVIDER_ENABLED: "true",
          YAHOO_AUCTIONS_JP_SCRAPING_ALLOWED: "true",
        },
      },
      {
        id: "mercari-jp",
        env: {
          MERCARI_JP_PROVIDER_ENABLED: "true",
          MERCARI_JP_SCRAPING_ALLOWED: "true",
        },
      },
      {
        id: "ebay",
        env: {
          EBAY_PROVIDER_ENABLED: "true",
          EBAY_CLIENT_ID: "fixture-client",
          EBAY_CLIENT_SECRET: "fixture-secret",
        },
      },
    ] as const;

    for (const fixture of cases) {
      const runtime = createProviderRuntime(
        loadProviderRuntimeConfig({
          PROVIDER_ALLOW_MOCK_FALLBACK: "false",
          PROVIDER_MOCK_ENABLED: "false",
          PROVIDER_RUNTIME_MODE: "real",
          ...fixture.env,
        }),
      );

      expect(runtime.activeProviders.map(({ provider }) => provider.id)).not.toContain(fixture.id);
      expect(runtime.preflightFailures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerId: fixture.id,
            failure: expect.objectContaining({ code: "authorization_required" }),
          }),
        ]),
      );
      expect(runtime.statuses.find(({ id }) => id === fixture.id)).toMatchObject({
        active: false,
        authorizationReferencePresent: false,
        lastErrorCategory: "authorization_required",
      });
    }
  });

  it("activates all five real marketplaces only when their explicit gates are complete", () => {
    const runtime = createProviderRuntime(
      loadProviderRuntimeConfig({
        PROVIDER_ALLOW_MOCK_FALLBACK: "false",
        PROVIDER_MAX_ACTIVE_PROVIDERS: "5",
        PROVIDER_MOCK_ENABLED: "false",
        PROVIDER_RUNTIME_MODE: "real",
        GRAILED_PROVIDER_ENABLED: "true",
        GRAILED_SCRAPING_ALLOWED: "true",
        GRAILED_AUTHORIZATION_REFERENCE: "grailed-approval-2026",
        DEPOP_PROVIDER_ENABLED: "true",
        DEPOP_SCRAPING_ALLOWED: "true",
        DEPOP_AUTHORIZATION_REFERENCE: "depop-approval-2026",
        YAHOO_AUCTIONS_JP_PROVIDER_ENABLED: "true",
        YAHOO_AUCTIONS_JP_SCRAPING_ALLOWED: "true",
        YAHOO_AUCTIONS_JP_AUTHORIZATION_REFERENCE: "yahoo-approval-2026",
        MERCARI_JP_PROVIDER_ENABLED: "true",
        MERCARI_JP_SCRAPING_ALLOWED: "true",
        MERCARI_JP_AUTHORIZATION_REFERENCE: "mercari-approval-2026",
        EBAY_PROVIDER_ENABLED: "true",
        EBAY_CLIENT_ID: "fixture-client",
        EBAY_CLIENT_SECRET: "fixture-secret",
        EBAY_AUTHORIZATION_REFERENCE: "ebay-approval-2026",
      }),
    );

    expect(runtime.activeProviders.map(({ provider }) => provider.id)).toEqual([
      "grailed",
      "depop",
      "yahoo-auctions-jp",
      "mercari-jp",
      "ebay",
    ]);
    expect(runtime.preflightFailures).toEqual([]);
    expect(
      runtime.statuses
        .filter(({ providerMode }) => providerMode === "real")
        .every(({ active, authorizationReferencePresent }) => {
          return active && authorizationReferencePresent === true;
        }),
    ).toBe(true);
  });

  it("returns predictable provider status metadata for the health/debug path", () => {
    const runtime = createProviderRuntime(
      loadProviderRuntimeConfig({
        PROVIDER_RUNTIME_MODE: "hybrid",
        GRAILED_PROVIDER_ENABLED: "true",
        GRAILED_SCRAPING_ALLOWED: "true",
        GRAILED_AUTHORIZATION_REFERENCE: "agreement-2026-01",
        GRAILED_USER_AGENT: "ClosetSearchBot/0.1 contact:team@example.com",
      }),
    );

    expect(runtime.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mock",
          providerMode: "mock",
          enabled: true,
          configured: true,
          active: true,
          mode: "fixture",
          implementationStatus: "available",
        }),
        expect.objectContaining({
          id: "grailed",
          providerMode: "real",
          enabled: true,
          configured: true,
          active: true,
          mode: "authorized-live",
          scrapingAllowed: true,
          implementationStatus: "available",
          requiredEnvVars: expect.arrayContaining([
            "GRAILED_PROVIDER_ENABLED",
            "GRAILED_SCRAPING_ALLOWED",
            "GRAILED_BASE_URL",
            "GRAILED_MAX_RESULTS_PER_SEARCH",
            "GRAILED_USER_AGENT",
          ]),
        }),
      ]),
    );
  });
});
