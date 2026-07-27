import { describe, expect, it } from "vitest";
import { validateStartupEnvironment } from "./startup-config.js";

const validProductionEnvironment = {
  AUTH_ALLOWED_ORIGINS: "https://closetsearch.example",
  AUTH_COOKIE_SECURE: "true",
  AUTH_SESSION_PEPPER: "a".repeat(32),
  ENGAGEMENT_SESSION_PEPPER: "e".repeat(32),
  NODE_ENV: "production",
  NOTIFICATION_DESTINATION_PEPPER: "n".repeat(32),
  OPERATIONS_BEARER_TOKEN: "o".repeat(32),
  DATABASE_URL: "postgresql://closetsearch:test@database:5432/closetsearch",
  PERSISTENCE_DRIVER: "postgres",
  PROVIDER_ALLOW_MOCK_FALLBACK: "false",
  PROVIDER_MOCK_ENABLED: "false",
  PROVIDER_RUNTIME_MODE: "real",
};

describe("startup environment validation", () => {
  it("accepts a fail-closed production configuration", () => {
    expect(validateStartupEnvironment(validProductionEnvironment)).toMatchObject({
      host: "127.0.0.1",
      port: 4_000,
      persistenceDriver: "postgres",
    });
  });

  it("rejects weak session secrets and mock production inventory", () => {
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        AUTH_SESSION_PEPPER: "short",
      }),
    ).toThrowError("at least 32");
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        PROVIDER_ALLOW_MOCK_FALLBACK: "true",
      }),
    ).toThrowError("Mock providers");
  });

  it("rejects insecure or development origins in production", () => {
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        AUTH_ALLOWED_ORIGINS: "http://localhost:5173",
      }),
    ).toThrowError("HTTPS origins");
  });

  it("rejects provider endpoints that could receive credentials or trigger SSRF", () => {
    const invalidOrigins = [
      ["EBAY_IDENTITY_BASE_URL", "http://attacker.invalid"],
      ["EBAY_API_BASE_URL", "https://api.ebay.com.attacker.invalid"],
      ["GRAILED_BASE_URL", "https://127.0.0.1:4444/internal"],
      ["DEPOP_BASE_URL", "https://webapi.depop.com.attacker.invalid"],
      ["YAHOO_AUCTIONS_JP_BASE_URL", "https://auctions.yahoo.co.jp.attacker.invalid"],
      ["MERCARI_JP_BASE_URL", "https://api.mercari.jp/internal"],
    ] as const;

    for (const [environmentKey, value] of invalidOrigins) {
      expect(() =>
        validateStartupEnvironment({
          ...validProductionEnvironment,
          [environmentKey]: value,
        }),
      ).toThrowError(environmentKey);
    }
  });

  it("fails closed when any enabled production provider lacks its authorization reference", () => {
    const incompleteProviders = [
      {
        GRAILED_PROVIDER_ENABLED: "true",
        GRAILED_SCRAPING_ALLOWED: "true",
      },
      {
        DEPOP_PROVIDER_ENABLED: "true",
        DEPOP_SCRAPING_ALLOWED: "true",
      },
      {
        YAHOO_AUCTIONS_JP_PROVIDER_ENABLED: "true",
        YAHOO_AUCTIONS_JP_SCRAPING_ALLOWED: "true",
      },
      {
        MERCARI_JP_PROVIDER_ENABLED: "true",
        MERCARI_JP_SCRAPING_ALLOWED: "true",
      },
      {
        EBAY_PROVIDER_ENABLED: "true",
        EBAY_CLIENT_ID: "client-id",
        EBAY_CLIENT_SECRET: "client-secret",
      },
    ];

    for (const providerEnvironment of incompleteProviders) {
      expect(() =>
        validateStartupEnvironment({
          ...validProductionEnvironment,
          ...providerEnvironment,
        }),
      ).toThrowError("provider-specific authorization reference");
    }
  });

  it("accepts enabled providers only with explicit production authorization gates", () => {
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        GRAILED_PROVIDER_ENABLED: "true",
        GRAILED_SCRAPING_ALLOWED: "true",
        GRAILED_AUTHORIZATION_REFERENCE: "grailed-authorization-2026",
        GRAILED_BASE_URL: "https://www.grailed.com",
        DEPOP_PROVIDER_ENABLED: "true",
        DEPOP_SCRAPING_ALLOWED: "true",
        DEPOP_AUTHORIZATION_REFERENCE: "depop-authorization-2026",
        DEPOP_BASE_URL: "https://webapi.depop.com",
        YAHOO_AUCTIONS_JP_PROVIDER_ENABLED: "true",
        YAHOO_AUCTIONS_JP_SCRAPING_ALLOWED: "true",
        YAHOO_AUCTIONS_JP_AUTHORIZATION_REFERENCE: "yahoo-authorization-2026",
        YAHOO_AUCTIONS_JP_BASE_URL: "https://auctions.yahoo.co.jp",
        MERCARI_JP_PROVIDER_ENABLED: "true",
        MERCARI_JP_SCRAPING_ALLOWED: "true",
        MERCARI_JP_AUTHORIZATION_REFERENCE: "mercari-authorization-2026",
        MERCARI_JP_BASE_URL: "https://api.mercari.jp",
        EBAY_PROVIDER_ENABLED: "true",
        EBAY_CLIENT_ID: "client-id",
        EBAY_CLIENT_SECRET: "client-secret",
        EBAY_AUTHORIZATION_REFERENCE: "ebay-authorization-2026",
        EBAY_API_BASE_URL: "https://api.ebay.com",
        EBAY_IDENTITY_BASE_URL: "https://api.ebay.com",
      }),
    ).not.toThrow();
  });

  it("rejects authorized-scraping providers whose explicit scraping flag is not true", () => {
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        MERCARI_JP_PROVIDER_ENABLED: "true",
        MERCARI_JP_AUTHORIZATION_REFERENCE: "mercari-authorization-2026",
      }),
    ).toThrowError("authorized-scraping flag");
  });

  it("requires PostgreSQL and a database URL in production", () => {
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        PERSISTENCE_DRIVER: "sqlite",
      }),
    ).toThrowError("forbidden in production");
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL: undefined,
      }),
    ).toThrowError("DATABASE_URL");
  });

  it("requires a dedicated engagement hashing pepper in production", () => {
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        ENGAGEMENT_SESSION_PEPPER: undefined,
      }),
    ).toThrowError("ENGAGEMENT_SESSION_PEPPER");
  });

  it("fails closed on invalid or incomplete production recommendation rollout", () => {
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        CLOSETSEARCH_RECOMMENDATION_MODE: "force-active",
      }),
    ).toThrowError("must be disabled, shadow, or active");
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        CLOSETSEARCH_RECOMMENDATION_MODE: "shadow",
      }),
    ).toThrowError("ARTIFACT_PATH");
    expect(() =>
      validateStartupEnvironment({
        ...validProductionEnvironment,
        CLOSETSEARCH_RECOMMENDATION_ARTIFACT_PATH: "/run/closetsearch/recommendation.json",
        CLOSETSEARCH_RECOMMENDATION_MODE: "active",
      }),
    ).toThrowError("PROMOTION_APPROVED=true");
  });

  it("allows SQLite only when explicitly selected outside production", () => {
    expect(
      validateStartupEnvironment({
        NODE_ENV: "development",
        PERSISTENCE_DRIVER: "sqlite",
      }),
    ).toMatchObject({
      persistenceDriver: "sqlite",
    });
    expect(() =>
      validateStartupEnvironment({
        NODE_ENV: "development",
      }),
    ).toThrowError("PERSISTENCE_DRIVER");
  });
});
