import type { IncomingMessage } from "node:http";
import { ApiError } from "../api-error.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitDecision {
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
}

function normalizeAddress(value: string | undefined) {
  return value?.trim().slice(0, 128) || "unknown";
}

export function getRequestIpHint(request: IncomingMessage) {
  return normalizeAddress(request.socket?.remoteAddress);
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(private readonly options: RateLimiterOptions) {}

  consume(key: string, now = Date.now()): RateLimitDecision {
    const normalizedKey = key.trim() || "unknown";
    const current = this.entries.get(normalizedKey);
    const entry =
      current && current.resetAt > now
        ? current
        : {
            count: 0,
            resetAt: now + this.options.windowMs,
          };

    entry.count += 1;
    this.entries.set(normalizedKey, entry);

    if (entry.count > this.options.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((entry.resetAt - now) / 1_000),
      );
      const error = new ApiError(
        429,
        "rate_limited",
        "Too many requests. Please wait before trying again.",
      ) as ApiError & { retryAfterSeconds?: number };
      error.retryAfterSeconds = retryAfterSeconds;
      throw error;
    }

    this.prune(now);

    return {
      limit: this.options.limit,
      remaining: Math.max(0, this.options.limit - entry.count),
      resetAt: entry.resetAt,
    };
  }

  reset() {
    this.entries.clear();
  }

  private prune(now: number) {
    if (this.entries.size < 1_000) {
      return;
    }

    for (const [key, entry] of this.entries.entries()) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
