import { describe, expect, it } from "vitest";
import { validateStartupEnvironment } from "./startup-config.js";

const validProductionEnvironment = {
  AUTH_ALLOWED_ORIGINS: "https://closetsearch.example",
  AUTH_COOKIE_SECURE: "true",
  AUTH_SESSION_PEPPER: "a".repeat(32),
  NODE_ENV: "production",
  PROVIDER_ALLOW_MOCK_FALLBACK: "false",
  PROVIDER_MOCK_ENABLED: "false",
  PROVIDER_RUNTIME_MODE: "real",
};

describe("startup environment validation", () => {
  it("accepts a fail-closed production configuration", () => {
    expect(validateStartupEnvironment(validProductionEnvironment)).toMatchObject({
      host: "127.0.0.1",
      port: 4_000,
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
});
