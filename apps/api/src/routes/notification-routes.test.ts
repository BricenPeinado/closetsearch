import { describe, expect, it } from "vitest";
import {
  isPermanentEmailDestinationFailure,
  isPermanentTwilioDestinationFailure,
  renderSmsWebhookTwiml,
} from "./notification-routes.js";

describe("notification webhook route helpers", () => {
  it("returns safe TwiML for SMS keyword confirmations", () => {
    expect(renderSmsWebhookTwiml("Alerts are off <now>. Reply START & resume.")).toEqual({
      body: '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Alerts are off &lt;now&gt;. Reply START &amp; resume.</Message></Response>',
      headers: {
        "cache-control": "no-store",
        "content-type": "application/xml; charset=utf-8",
      },
      kind: "text",
      statusCode: 200,
    });
  });

  it("suppresses only explicit permanent recipient failures", () => {
    expect(
      isPermanentEmailDestinationFailure("email.failed", {
        data: {
          failed: {
            reason: "invalid_recipient",
          },
        },
      }),
    ).toBe(true);
    expect(
      isPermanentEmailDestinationFailure("email.failed", {
        data: {
          failed: {
            reason: "reached_daily_quota",
          },
        },
      }),
    ).toBe(false);
    expect(isPermanentTwilioDestinationFailure("failed", "21211")).toBe(true);
    expect(isPermanentTwilioDestinationFailure("failed", "21610")).toBe(true);
    expect(isPermanentTwilioDestinationFailure("undelivered", "30003")).toBe(false);
    expect(isPermanentTwilioDestinationFailure("sent", "21211")).toBe(false);
  });
});
