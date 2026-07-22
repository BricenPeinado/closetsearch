import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, fetchJson, sendJson } from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api-client", () => {
  it("normalizes network failures into a safe retryable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    await expect(fetchJson("/health")).rejects.toMatchObject({
      code: "network_error",
      message: "ClosetSearch could not reach the server. Check your connection and try again.",
      name: "ApiClientError",
      status: 0,
    } satisfies Partial<ApiClientError>);
  });

  it("maps provider-unavailable responses into beta-safe search copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "search_unavailable",
            message: "The search request could not be completed right now.",
          }),
          {
            status: 502,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    await expect(fetchJson("/search?q=kapital")).rejects.toMatchObject({
      code: "search_unavailable",
      message:
        "Search is temporarily unavailable. Results may be limited right now. Please try again.",
      status: 502,
    } satisfies Partial<ApiClientError>);
  });

  it("preserves structured auth errors for protected mutations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "session_expired",
            message: "Your session expired. Please log in again.",
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    await expect(sendJson("/me/watchlists", "POST", { brand: "Kapital" })).rejects.toMatchObject({
      code: "session_expired",
      message: "Your session expired. Please log in again.",
      status: 401,
    } satisfies Partial<ApiClientError>);
  });
});
