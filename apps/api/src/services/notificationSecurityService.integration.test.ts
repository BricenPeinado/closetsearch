import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import { NotificationSecurityService } from "./notificationSecurityService.js";
import {
  CaptureEmailTransport,
  CaptureSmsTransport,
  DeliveryTransportError,
  type SmsTransport,
} from "./notificationTransports.js";

const start = new Date("2030-07-26T12:00:00.000Z");
type TestHarness = Awaited<ReturnType<typeof createPostgresTestHarness>>;

async function createUser(harness: TestHarness, email?: string) {
  const userId = randomUUID();
  await harness.database.query(
    `INSERT INTO users (
       id, username, normalized_username, password_hash, created_at
     ) VALUES ($1, $2, $2, 'scrypt$test', $3)`,
    [userId, `user-${userId.slice(0, 8)}`, start],
  );
  if (email) {
    await harness.database.query(
      `INSERT INTO user_identities (
         id, user_id, identity_type, provider, provider_subject,
         normalized_email, verified_at, created_at
       ) VALUES ($1, $2, 'email', 'password', $3, $3, $4, $4)`,
      [randomUUID(), userId, email, start],
    );
  }
  return userId;
}

function service(
  harness: TestHarness,
  input: {
    code?: string;
    now?: () => Date;
    smsTransport?: SmsTransport;
  } = {},
) {
  return new NotificationSecurityService(harness.dataPlane, {
    emailTransport: new CaptureEmailTransport(),
    env: {
      ALERT_PUBLIC_BASE_URL: "http://localhost:5173",
      AUTH_SESSION_PEPPER: "p".repeat(32),
      NODE_ENV: "test",
    },
    generateCode: () => input.code ?? "123456",
    now: input.now ?? (() => start),
    smsTransport: input.smsTransport ?? new CaptureSmsTransport(),
  });
}

describe("NotificationSecurityService durable security state", () => {
  const harnesses: TestHarness[] = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.database.close()));
  });

  it("keeps unsubscribe GET non-mutating and consumes the POST token", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const email = "unsubscribe@example.com";
    const userId = await createUser(harness, email);
    await harness.dataPlane.notifications.updateSettings({
      emailEnabled: true,
      userId,
    });
    await harness.dataPlane.notifications.recordConsent({
      action: "opt_in",
      channel: "email",
      destination: email,
      occurredAt: start,
      source: "test",
      userId,
    });
    const notificationService = service(harness);
    const token = await notificationService.createUnsubscribeToken(userId, email, "delivery-1");

    await expect(notificationService.inspectEmailUnsubscribe(token)).resolves.toEqual({
      status: "confirmation_required",
    });
    await expect(harness.dataPlane.notifications.getSettings(userId)).resolves.toMatchObject({
      emailEnabled: true,
    });
    await expect(notificationService.unsubscribeEmail(token)).resolves.toEqual({
      status: "unsubscribed",
    });
    await expect(harness.dataPlane.notifications.getSettings(userId)).resolves.toMatchObject({
      emailEnabled: false,
    });
    await expect(notificationService.unsubscribeEmail(token)).resolves.toEqual({
      status: "invalid_or_expired",
    });
    const stored = await harness.database.query<{ token_hash: string }>(
      `SELECT token_hash FROM notification_unsubscribe_tokens`,
    );
    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.token_hash).not.toBe(token);
  });

  it("allows duplicate unverified phones but only one account can verify", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const firstUser = await createUser(harness);
    const secondUser = await createUser(harness);
    let current = start;
    const firstService = service(harness, {
      code: "111111",
      now: () => current,
    });
    const secondService = service(harness, {
      code: "222222",
      now: () => current,
    });
    const phone = "+12025550123";

    await firstService.setPhone({ consent: true, phone, userId: firstUser });
    await secondService.setPhone({ consent: true, phone, userId: secondUser });
    await expect(firstService.requestPhoneVerification(firstUser)).resolves.toMatchObject({
      status: "requested",
    });
    current = new Date(start.getTime() + 61_000);
    await expect(secondService.requestPhoneVerification(secondUser)).resolves.toMatchObject({
      status: "requested",
    });
    await expect(firstService.verifyPhone(firstUser, "111111")).resolves.toMatchObject({
      status: "verified",
    });
    await expect(secondService.verifyPhone(secondUser, "222222")).resolves.toEqual({
      status: "phone_in_use",
    });

    const thirdUser = await createUser(harness);
    const thirdService = service(harness, {
      code: "333333",
      now: () => current,
    });
    await thirdService.setPhone({ consent: true, phone, userId: thirdUser });
    await expect(thirdService.requestPhoneVerification(thirdUser)).resolves.toEqual({
      status: "destination_suppressed",
    });
  });

  it("enforces a shared account rate limit across repository instances", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const userId = await createUser(harness);
    const secondDataPlane = new PostgresDataPlane(harness.database, {
      alerts: { useSkipLocked: false },
    });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const repository =
        attempt % 2 === 0 ? harness.dataPlane.notifications : secondDataPlane.notifications;
      await expect(
        repository.consumeActorRateLimit({
          action: "phone_verification_request",
          at: new Date(start.getTime() + attempt),
          limit: 6,
          userId,
          windowMs: 10 * 60_000,
        }),
      ).resolves.toBe(true);
    }
    await expect(
      secondDataPlane.notifications.consumeActorRateLimit({
        action: "phone_verification_request",
        at: new Date(start.getTime() + 10_000),
        limit: 6,
        userId,
        windowMs: 10 * 60_000,
      }),
    ).resolves.toBe(false);
  });

  it("uses claim tokens so an expired webhook handler cannot finish a reclaimed event", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const first = await harness.dataPlane.notifications.claimWebhookEvent({
      eventType: "email.bounced",
      payloadDigest: "a".repeat(64),
      provider: "resend",
      providerEventId: "event-1",
      receivedAt: start,
      staleBefore: new Date(start.getTime() - 1),
    });
    expect(first.status).toBe("claimed");
    const reclaimedAt = new Date(start.getTime() + 6 * 60_000);
    const second = await harness.dataPlane.notifications.claimWebhookEvent({
      eventType: "email.bounced",
      payloadDigest: "a".repeat(64),
      provider: "resend",
      providerEventId: "event-1",
      receivedAt: reclaimedAt,
      staleBefore: new Date(start.getTime() + 60_000),
    });
    expect(second.status).toBe("claimed");

    if (first.status !== "claimed" || second.status !== "claimed") {
      throw new Error("Expected both webhook claims.");
    }
    await expect(
      harness.dataPlane.notifications.completeWebhookEvent(
        "resend",
        "event-1",
        first.claimToken,
        reclaimedAt,
      ),
    ).resolves.toBe(false);
    await expect(
      harness.dataPlane.notifications.releaseWebhookEventClaim(
        "resend",
        "event-1",
        first.claimToken,
      ),
    ).resolves.toBe(false);
    await expect(
      harness.dataPlane.notifications.completeWebhookEvent(
        "resend",
        "event-1",
        second.claimToken,
        reclaimedAt,
      ),
    ).resolves.toBe(true);
  });

  it("suppresses invalid and STOP-blocked verification destinations", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);

    for (const failure of [
      {
        phone: "+12025550123",
        reason: "invalid_destination" as const,
      },
      {
        phone: "+12025550124",
        reason: "sms_stop" as const,
      },
    ]) {
      const userId = await createUser(harness);
      const smsTransport: SmsTransport = {
        configured: true,
        kind: "capture",
        async send() {
          throw new DeliveryTransportError(
            "SMS destination is unavailable.",
            failure.reason === "sms_stop" ? "sms_provider_21610" : "sms_provider_21211",
            true,
            undefined,
            failure.reason === "invalid_destination",
            failure.reason,
          );
        },
      };
      const notificationService = service(harness, { smsTransport });
      await notificationService.setPhone({
        consent: true,
        phone: failure.phone,
        userId,
      });
      await harness.dataPlane.notifications.updateSettings({
        smsEnabled: true,
        userId,
      });

      await expect(notificationService.requestPhoneVerification(userId)).resolves.toEqual({
        status: "destination_suppressed",
      });
      await expect(
        harness.dataPlane.notifications.isSuppressed("sms", failure.phone),
      ).resolves.toBe(true);
      await expect(harness.dataPlane.notifications.getSettings(userId)).resolves.toMatchObject({
        smsEnabled: false,
      });

      if (failure.reason === "sms_stop") {
        await expect(
          harness.dataPlane.notifications.hasActiveConsent("sms", failure.phone),
        ).resolves.toBe(false);
      }
    }
  });
});
