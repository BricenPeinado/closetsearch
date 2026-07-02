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

  it("returns predictable provider status metadata for the health/debug path", () => {
    const runtime = createProviderRuntime(
      loadProviderRuntimeConfig({
        PROVIDER_RUNTIME_MODE: "hybrid",
        GRAILED_PROVIDER_ENABLED: "true",
        GRAILED_SCRAPING_ALLOWED: "true",
        GRAILED_USER_AGENT: "ClosetSearchBot/0.1 contact:team@example.com",
      }),
    );

    expect(runtime.statuses).toEqual([
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
          "GRAILED_USER_AGENT",
        ]),
      }),
    ]);
  });
});
