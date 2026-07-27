import { describe, expect, it } from "vitest";
import { alertDeliveryRetryAt, buildAlertSmsText } from "./alertDeliveryService.js";
import { nextAllowedDeliveryAt } from "../db/postgres/repositories/alerts.js";

describe("alert delivery retry schedule", () => {
  const now = new Date("2030-07-26T12:00:00.000Z");

  it("adds bounded jitter while preserving a provider Retry-After floor", () => {
    expect(alertDeliveryRetryAt(now, 2, undefined, () => 1).getTime() - now.getTime()).toBe(2_500);
    expect(alertDeliveryRetryAt(now, 2, 8_000, () => 1).getTime() - now.getTime()).toBe(8_000);
    expect(alertDeliveryRetryAt(now, 30, undefined, () => 1).getTime() - now.getTime()).toBe(
      375_000,
    );
  });

  it("bounds provider-controlled Unicode titles and URLs to a concise SMS", () => {
    const text = buildAlertSmsText({
      label: "Price drop",
      title: "🧥".repeat(1_000),
      url: `https://example.com/${"x".repeat(3_000)}`,
    });

    expect(Array.from(text).length).toBeLessThanOrEqual(480);
    expect(text).toContain("Reply STOP to opt out.");
  });

  it("resolves quiet-hour ends as local wall time across DST changes", () => {
    const policy = {
      frequency: "instant" as const,
      quietHoursEnd: "08:00",
      quietHoursStart: "00:00",
      timezone: "America/New_York",
    };

    expect(nextAllowedDeliveryAt(new Date("2030-11-03T05:30:00.000Z"), policy).toISOString()).toBe(
      "2030-11-03T13:00:01.000Z",
    );
    expect(nextAllowedDeliveryAt(new Date("2030-03-10T06:30:00.000Z"), policy).toISOString()).toBe(
      "2030-03-10T12:00:01.000Z",
    );
  });
});
