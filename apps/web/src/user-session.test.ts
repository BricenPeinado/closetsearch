import type { AuthResponse } from "@closetsearch/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api-client";
import { getAuthErrorMessage, isAuthRequiredError, loadUserSession } from "./user-session";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("user-session", () => {
  it("loads the current session from /auth/me", async () => {
    const session: AuthResponse = {
      userId: "user-1",
      user: {
        id: "user-1",
        username: "archivekid",
        onboardingPreferences: {
          favoriteBrands: [],
          categories: [],
          priceRange: "",
        },
        currencyPreference: "USD",
        createdAt: "2026-07-02T12:00:00.000Z",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue(session),
        ok: true,
      }),
    );

    await expect(loadUserSession()).resolves.toEqual(session);
  });

  it("returns null when /auth/me responds with an auth-required error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          error: "session_expired",
          message: "Your session has expired. Please log in again.",
        }),
        ok: false,
        status: 401,
      }),
    );

    await expect(loadUserSession()).resolves.toBeNull();
  });

  it("maps structured auth errors into user-facing messages", () => {
    const sessionExpiredError = new ApiClientError(
      401,
      "session_expired",
      "Your session has expired. Please log in again.",
    );

    expect(isAuthRequiredError(sessionExpiredError)).toBe(true);
    expect(getAuthErrorMessage(sessionExpiredError, "fallback")).toBe(
      "Your session expired. Please log in again.",
    );
  });
});
