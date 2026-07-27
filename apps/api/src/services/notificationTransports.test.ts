import { describe, expect, it, vi } from "vitest";
import {
  CaptureEmailTransport,
  CaptureSmsTransport,
  DisabledEmailTransport,
  ResendEmailTransport,
  TwilioSmsTransport,
} from "./notificationTransports.js";

describe("notification transports", () => {
  it("captures email and SMS without making network calls", async () => {
    const email = new CaptureEmailTransport();
    const sms = new CaptureSmsTransport();

    await email.send({
      idempotencyKey: "email-1",
      subject: "Price drop",
      text: "A listing dropped in price.",
      to: "USER@example.com",
    });
    await sms.send({
      idempotencyKey: "sms-1",
      text: "Price drop. Reply STOP to opt out.",
      to: "+12025550123",
    });

    expect(email.messages).toEqual([
      expect.objectContaining({ idempotencyKey: "email-1", to: "USER@example.com" }),
    ]);
    expect(sms.messages).toEqual([
      expect.objectContaining({ idempotencyKey: "sms-1", to: "+12025550123" }),
    ]);
  });

  it("keeps disabled delivery fail-closed", async () => {
    await expect(
      new DisabledEmailTransport().send({
        idempotencyKey: "disabled",
        subject: "Disabled",
        text: "Disabled",
        to: "user@example.com",
      }),
    ).rejects.toMatchObject({
      code: "transport_disabled",
      terminal: true,
    });
  });

  it("sends Resend-style requests with credentials and idempotency", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-provider-1" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const transport = new ResendEmailTransport(
      "resend-secret",
      "ClosetSearch <alerts@example.com>",
      fetchImplementation,
    );

    await expect(
      transport.send({
        idempotencyKey: "email-idempotency",
        subject: "Watchlist match",
        text: "A listing matched.",
        to: "user@example.com",
      }),
    ).resolves.toMatchObject({
      providerMessageId: "email-provider-1",
      status: "accepted",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer resend-secret",
          "idempotency-key": "email-idempotency",
        }),
        method: "POST",
      }),
    );
  });

  it("sends Twilio-style form requests with basic authentication", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ sid: "SM123", status: "queued" }), {
        status: 201,
      }),
    );
    const transport = new TwilioSmsTransport(
      "AC123",
      "auth-secret",
      "+12025550100",
      fetchImplementation,
      "https://api.example.com/webhooks/sms",
    );

    await expect(
      transport.send({
        deliveryId: "7e5b02bc-f48c-4cbc-9a45-15e55ae33a58",
        idempotencyKey: "sms-idempotency",
        text: "Watchlist match. Reply STOP to opt out.",
        to: "+12025550123",
      }),
    ).resolves.toMatchObject({
      providerMessageId: "SM123",
      status: "accepted",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json",
      expect.objectContaining({
        body: expect.any(URLSearchParams),
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from("AC123:auth-secret").toString("base64")}`,
        }),
        method: "POST",
      }),
    );
    const request = fetchImplementation.mock.calls[0]?.[1];
    expect((request?.body as URLSearchParams).get("StatusCallback")).toBe(
      "https://api.example.com/webhooks/sms?deliveryId=7e5b02bc-f48c-4cbc-9a45-15e55ae33a58",
    );
    expect(request?.headers).not.toHaveProperty("idempotency-key");
  });

  it("never propagates provider bodies, destinations, or credentials into durable errors", async () => {
    const privateProviderBody = "invalid to=user@example.com token=provider-secret account=AC123";
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(privateProviderBody, {
        status: 400,
      }),
    );
    const transport = new ResendEmailTransport(
      "provider-secret",
      "alerts@example.com",
      fetchImplementation,
    );

    const failure = await transport
      .send({
        idempotencyKey: "private-error",
        subject: "Test",
        text: "Test",
        to: "user@example.com",
      })
      .catch((error: unknown) => error);
    const serialized = JSON.stringify({
      code: (failure as { code?: unknown }).code,
      message: failure instanceof Error ? failure.message : "",
    });

    expect(serialized).toContain("email_provider_400");
    expect(serialized).not.toContain(privateProviderBody);
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("AC123");
  });

  it("rejects an oversized SMS before any provider request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const transport = new TwilioSmsTransport(
      "AC123",
      "auth-secret",
      "+12025550100",
      fetchImplementation,
    );

    await expect(
      transport.send({
        idempotencyKey: "oversized",
        text: "🧥".repeat(1_601),
        to: "+12025550123",
      }),
    ).rejects.toMatchObject({
      code: "sms_body_too_long",
      terminal: true,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("never retries an ambiguous Twilio network or server outcome", async () => {
    const networkTransport = new TwilioSmsTransport(
      "AC123",
      "auth-secret",
      "+12025550100",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("socket reset")),
    );
    const serverTransport = new TwilioSmsTransport(
      "AC123",
      "auth-secret",
      "+12025550100",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("possibly accepted: to=+12025550123", { status: 503 })),
    );
    const message = {
      idempotencyKey: "ambiguous",
      text: "Watchlist match. Reply STOP to opt out.",
      to: "+12025550123",
    };

    await expect(networkTransport.send(message)).rejects.toMatchObject({
      code: "sms_provider_outcome_unknown",
      terminal: true,
    });
    await expect(serverTransport.send(message)).rejects.toMatchObject({
      code: "sms_provider_outcome_unknown",
      terminal: true,
    });
  });

  it("classifies Twilio's permanent destination codes without leaking its body", async () => {
    const privateBody = {
      code: 21211,
      message: "Invalid To +12025550123; token=provider-secret",
      more_info: "https://www.twilio.com/docs/errors/21211",
    };
    const transport = new TwilioSmsTransport(
      "AC123",
      "provider-secret",
      "+12025550100",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(privateBody), { status: 400 })),
    );
    const failure = await transport
      .send({
        idempotencyKey: "invalid-number",
        text: "Watchlist match. Reply STOP to opt out.",
        to: "+12025550123",
      })
      .catch((error: unknown) => error);
    const serialized = JSON.stringify({
      code: (failure as { code?: unknown }).code,
      destinationInvalid: (failure as { destinationInvalid?: unknown }).destinationInvalid,
      message: failure instanceof Error ? failure.message : "",
      terminal: (failure as { terminal?: unknown }).terminal,
    });

    expect(serialized).toContain("sms_provider_21211");
    expect(serialized).toContain('"destinationInvalid":true');
    expect(serialized).not.toContain(privateBody.message);
    expect(serialized).not.toContain("+12025550123");
    expect(serialized).not.toContain("provider-secret");
  });

  it("classifies Twilio 21610 as a durable SMS STOP suppression", async () => {
    const transport = new TwilioSmsTransport(
      "AC123",
      "auth-secret",
      "+12025550100",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ code: 21610 }), { status: 400 })),
    );

    await expect(
      transport.send({
        idempotencyKey: "stopped-recipient",
        text: "Watchlist match. Reply STOP to opt out.",
        to: "+12025550123",
      }),
    ).rejects.toMatchObject({
      code: "sms_provider_21610",
      suppressionReason: "sms_stop",
      terminal: true,
    });
  });
});
