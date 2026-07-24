import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";
import {
  enforceEngagementRateLimit,
  resetEngagementRateLimitsForTests,
} from "./engagement-routes.js";

describe("engagement route rate limiting", () => {
  beforeEach(() => {
    resetEngagementRateLimitsForTests();
  });

  it("bounds anonymous events per opaque privacy session", () => {
    const request = {
      socket: {
        remoteAddress: "198.51.100.27",
      },
    } as IncomingMessage;

    for (let index = 0; index < 120; index += 1) {
      expect(() => enforceEngagementRateLimit(request, "opaque-rate-limit-session")).not.toThrow();
    }

    expect(() => enforceEngagementRateLimit(request, "opaque-rate-limit-session")).toThrow(
      expect.objectContaining({
        code: "rate_limited",
        statusCode: 429,
      }),
    );
  });
});
