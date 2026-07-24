import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("enforces a bounded window and exposes a retry delay", () => {
    const limiter = new FixedWindowRateLimiter({
      limit: 2,
      windowMs: 10_000,
    });

    expect(limiter.consume("client", 1_000).remaining).toBe(1);
    expect(limiter.consume("client", 1_001).remaining).toBe(0);
    expect(() => limiter.consume("client", 1_002)).toThrowError("Too many requests");

    try {
      limiter.consume("client", 1_002);
    } catch (error) {
      expect(error).toMatchObject({
        code: "rate_limited",
        retryAfterSeconds: 10,
        statusCode: 429,
      });
    }

    expect(limiter.consume("client", 11_001).remaining).toBe(1);
  });
});
