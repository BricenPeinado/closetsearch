import { describe, expect, it } from "vitest";
import { verifyResendWebhook, verifyTwilioWebhook } from "./webhookVerification.js";

describe("notification webhook verification", () => {
  it("verifies the independent Svix reference vector and rejects tampering or replay", () => {
    // Pinned upstream Svix SDK test vector. Keeping the literal signature here
    // prevents a shared bug in this module's signer and verifier from passing.
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const body = Buffer.from('{"test": 2432232314}');
    const timestamp = 1_614_265_330;
    const headers = {
      "svix-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
      "svix-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
      "svix-timestamp": String(timestamp),
    };

    expect(
      verifyResendWebhook({
        headers,
        now: new Date(timestamp * 1_000),
        rawBody: body,
        secret,
      }),
    ).toMatchObject({ providerEventId: "msg_p5jXN8AQM9LWM0D4loKWxJek" });
    expect(
      verifyResendWebhook({
        headers,
        now: new Date(timestamp * 1_000),
        rawBody: Buffer.from('{"test": 2432232315}'),
        secret,
      }),
    ).toBeUndefined();
    expect(
      verifyResendWebhook({
        headers,
        now: new Date((timestamp + 301) * 1_000),
        rawBody: body,
        secret,
      }),
    ).toBeUndefined();
  });

  it("verifies Twilio's published form-signature reference vector", () => {
    const url = "https://example.com/myapp.php?foo=1&bar=2";
    const parameters = new URLSearchParams({
      CallSid: "CA1234567890ABCDE",
      Caller: "+14158675310",
      Digits: "1234",
      From: "+14158675310",
      To: "+18005551212",
    });

    expect(
      verifyTwilioWebhook({
        headers: { "x-twilio-signature": "L/OH5YylLD5NRKLltdqwSvS0BnU=" },
        parameters,
        secret: "12345",
        url,
      }),
    ).toBe(true);
    parameters.set("Digits", "4321");
    expect(
      verifyTwilioWebhook({
        headers: { "x-twilio-signature": "L/OH5YylLD5NRKLltdqwSvS0BnU=" },
        parameters,
        secret: "12345",
        url,
      }),
    ).toBe(false);
  });

  it("preserves the full query URL and duplicate form values", () => {
    const url =
      "https://example.com/webhooks/sms?deliveryId=7e5b02bc-f48c-4cbc-9a45-15e55ae33a58&mode=status";
    const parameters = new URLSearchParams();
    parameters.append("Tag", "omega");
    parameters.append("MessageStatus", "sent");
    parameters.append("Tag", "alpha");
    parameters.append("MessageSid", "SM123");

    expect(
      verifyTwilioWebhook({
        headers: { "x-twilio-signature": "jNUINCvUwJqp/neueBq/G9mLzz4=" },
        parameters,
        secret: "test-auth-token-32-characters!!",
        url,
      }),
    ).toBe(true);
  });
});
