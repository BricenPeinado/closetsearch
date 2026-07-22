import { describe, expect, it } from "vitest";
import { getAuthConfig } from "./config.js";

describe("getAuthConfig", () => {
  it("uses sane local defaults when env is empty", () => {
    const config = getAuthConfig({});

    expect(Array.from(config.allowedOrigins)).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
    expect(config.cookieName).toBe("closetsearch_session");
    expect(config.cookieSecure).toBe(false);
    expect(config.sessionTtlDays).toBe(14);
    expect(config.sessionTtlSeconds).toBe(14 * 24 * 60 * 60);
    expect(config.tokenPepper).toBe("");
  });

  it("parses explicit env overrides and falls back safely for invalid values", () => {
    const config = getAuthConfig({
      AUTH_ALLOWED_ORIGINS: "https://beta.closetsearch.example, https://staging.closetsearch.example ",
      AUTH_COOKIE_SECURE: "true",
      AUTH_SESSION_COOKIE_NAME: "beta_session",
      AUTH_SESSION_PEPPER: "session-pepper",
      AUTH_SESSION_TTL_DAYS: "21",
      NODE_ENV: "production",
    });

    expect(Array.from(config.allowedOrigins)).toEqual([
      "https://beta.closetsearch.example",
      "https://staging.closetsearch.example",
    ]);
    expect(config.cookieName).toBe("beta_session");
    expect(config.cookieSecure).toBe(true);
    expect(config.sessionTtlDays).toBe(21);
    expect(config.sessionTtlMs).toBe(21 * 24 * 60 * 60 * 1_000);
    expect(config.tokenPepper).toBe("session-pepper");
  });

  it("prefers stable defaults when boolean or integer env values are invalid", () => {
    const config = getAuthConfig({
      AUTH_ALLOWED_ORIGINS: "   ",
      AUTH_COOKIE_SECURE: "sometimes",
      AUTH_SESSION_TTL_DAYS: "0",
      NODE_ENV: "development",
    });

    expect(Array.from(config.allowedOrigins)).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
    expect(config.cookieSecure).toBe(false);
    expect(config.sessionTtlDays).toBe(14);
  });
});
