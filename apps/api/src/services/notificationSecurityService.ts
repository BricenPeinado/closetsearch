import { createHash, createHmac, randomInt } from "node:crypto";
import { getAuthConfig } from "../auth/config.js";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import type { NotificationChannel } from "../db/postgres/repositories/notifications.js";
import { hashNotificationDestination } from "../db/postgres/repositories/notifications.js";
import {
  createEmailTransportFromEnvironment,
  createSmsTransportFromEnvironment,
  DeliveryTransportError,
  type EmailTransport,
  type SmsTransport,
} from "./notificationTransports.js";

const phoneChallengeTtlMs = 10 * 60 * 1_000;
const unsubscribeTtlMs = 30 * 24 * 60 * 60 * 1_000;

function normalizedPublicBaseUrl(value: string | undefined, nodeEnv: string | undefined) {
  const raw = value?.trim();

  if (!raw) {
    return undefined;
  }

  const url = new URL(raw);
  const localHttp =
    nodeEnv !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (url.protocol !== "https:" && !localHttp) {
    throw new TypeError("ALERT_PUBLIC_BASE_URL must use HTTPS outside local development.");
  }

  return url;
}

export interface NotificationSecurityServiceOptions {
  emailTransport?: EmailTransport;
  env?: Record<string, string | undefined>;
  generateCode?: () => string;
  now?: () => Date;
  pepper?: string;
  smsTransport?: SmsTransport;
}

export class NotificationSecurityService {
  private readonly emailTransport: EmailTransport;
  private readonly env: Record<string, string | undefined>;
  private readonly generateCode: () => string;
  private readonly now: () => Date;
  private readonly pepper: string;
  private readonly publicBaseUrl: URL | undefined;
  private readonly smsTransport: SmsTransport;

  constructor(
    private readonly dataPlane: PostgresDataPlane,
    options: NotificationSecurityServiceOptions = {},
  ) {
    this.env = options.env ?? process.env;
    this.emailTransport = options.emailTransport ?? createEmailTransportFromEnvironment(this.env);
    this.smsTransport = options.smsTransport ?? createSmsTransportFromEnvironment(this.env);
    this.generateCode =
      options.generateCode ?? (() => randomInt(0, 1_000_000).toString().padStart(6, "0"));
    this.now = options.now ?? (() => new Date());
    this.pepper = (options.pepper ?? getAuthConfig(this.env).tokenPepper).trim();
    this.publicBaseUrl = normalizedPublicBaseUrl(this.env.ALERT_PUBLIC_BASE_URL, this.env.NODE_ENV);
  }

  private phoneCodeHash(userId: string, phoneIdentityId: string, code: string) {
    return createHmac("sha256", this.signingPepper())
      .update("closetsearch-phone-verification-v1")
      .update("\0")
      .update(userId)
      .update("\0")
      .update(phoneIdentityId)
      .update("\0")
      .update(code)
      .digest("hex");
  }

  private signingPepper() {
    if (this.pepper.length < 32) {
      throw new Error(
        "AUTH_SESSION_PEPPER must contain at least 32 characters for notification signing.",
      );
    }

    return this.pepper;
  }

  async setPhone(input: { consent: boolean; phone: string; userId: string }) {
    if (!input.consent) {
      throw new TypeError("SMS consent must be explicitly acknowledged.");
    }

    const occurredAt = this.now();
    const identity = await this.dataPlane.notifications.upsertPhoneIdentity(
      input.userId,
      input.phone,
      occurredAt,
    );
    await this.dataPlane.notifications.recordConsent({
      action: "opt_in",
      channel: "sms",
      destination: identity.phoneE164,
      metadata: {
        disclosureVersion: "sms-alerts-v1",
      },
      occurredAt,
      source: "account_settings",
      userId: input.userId,
    });
    return identity;
  }

  async requestPhoneVerification(userId: string) {
    if (!this.smsTransport.configured) {
      return { status: "delivery_unavailable" as const };
    }

    const identity = await this.dataPlane.notifications.getPhoneIdentity(userId);

    if (!identity) {
      return { status: "phone_missing" as const };
    }
    if (identity.verifiedAt) {
      return { status: "already_verified" as const };
    }

    const code = this.generateCode();

    if (!/^[0-9]{6}$/.test(code)) {
      throw new Error("Generated phone verification code must contain exactly six digits.");
    }

    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + phoneChallengeTtlMs);
    const persisted = await this.dataPlane.notifications.issuePhoneChallenge({
      codeHash: this.phoneCodeHash(userId, identity.id, code),
      expiresAt,
      issuedAt,
      userId,
    });

    if (persisted.status === "phone_missing") {
      return { status: "phone_missing" as const };
    }
    if (persisted.status === "cooldown") {
      return { status: "rate_limited" as const };
    }
    if (persisted.status === "suppressed") {
      return { status: "destination_suppressed" as const };
    }

    try {
      await this.smsTransport.send({
        idempotencyKey: `phone-verification:${identity.id}:${expiresAt.toISOString()}`,
        text: `Your ClosetSearch verification code is ${code}. It expires in 10 minutes. Reply STOP to opt out.`,
        to: identity.phoneE164,
      });
    } catch (error) {
      const failure = error instanceof DeliveryTransportError ? error : undefined;
      const suppressionReason =
        failure?.suppressionReason ??
        (failure?.destinationInvalid ? "invalid_destination" : undefined);

      if (!suppressionReason) {
        throw error;
      }

      const occurredAt = this.now();

      if (suppressionReason === "sms_stop") {
        await this.dataPlane.notifications.recordConsent({
          action: "opt_out",
          channel: "sms",
          destination: identity.phoneE164,
          occurredAt,
          source: "sms_provider_stop",
          userId,
        });
      }
      await this.dataPlane.notifications.suppressDestination({
        channel: "sms",
        destination: identity.phoneE164,
        occurredAt,
        reason: suppressionReason,
        userId,
      });
      await this.dataPlane.notifications.setChannelEnabled(userId, "sms", false);
      return { status: "destination_suppressed" as const };
    }

    return {
      expiresAt: expiresAt.toISOString(),
      status: "requested" as const,
    };
  }

  async verifyPhone(userId: string, code: string) {
    const identity = await this.dataPlane.notifications.getPhoneIdentity(userId);

    if (!identity || !/^[0-9]{6}$/.test(code)) {
      return { status: "invalid_or_expired" as const };
    }

    const result = await this.dataPlane.notifications.verifyPhoneChallenge(
      userId,
      this.phoneCodeHash(userId, identity.id, code),
      this.now(),
    );

    return result;
  }

  async removePhone(userId: string) {
    return this.dataPlane.notifications.removePhoneIdentity(userId, this.now());
  }

  private unsubscribeTokenHash(token: string) {
    return createHmac("sha256", this.signingPepper())
      .update("closetsearch-unsubscribe-token-hash-v1")
      .update("\0")
      .update(token)
      .digest("hex");
  }

  async createUnsubscribeToken(
    userId: string,
    destination: string,
    idempotencyKey: string,
    expiresAt = new Date(this.now().getTime() + unsubscribeTtlMs),
  ) {
    const destinationHash = hashNotificationDestination(destination);
    const token = createHmac("sha256", this.signingPepper())
      .update("closetsearch-unsubscribe-token-v3")
      .update("\0")
      .update(userId)
      .update("\0")
      .update(destinationHash)
      .update("\0")
      .update(idempotencyKey)
      .digest("base64url");
    await this.dataPlane.notifications.storeEmailUnsubscribeToken({
      createdAt: this.now(),
      destinationHash,
      expiresAt,
      idempotencyKey,
      tokenHash: this.unsubscribeTokenHash(token),
      userId,
    });
    return token;
  }

  async unsubscribeUrl(userId: string, destination: string, idempotencyKey: string) {
    if (!this.publicBaseUrl) {
      throw new Error("ALERT_PUBLIC_BASE_URL is required to create notification action links.");
    }

    const url = new URL("/notifications/unsubscribe", this.publicBaseUrl);
    url.searchParams.set(
      "token",
      await this.createUnsubscribeToken(userId, destination, idempotencyKey),
    );
    return url.toString();
  }

  private async verifyUnsubscribeToken(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return undefined;
    }

    return this.dataPlane.notifications.findActiveEmailUnsubscribeToken(
      this.unsubscribeTokenHash(token),
      this.now(),
    );
  }

  async inspectEmailUnsubscribe(token: string) {
    const verified = await this.verifyUnsubscribeToken(token);

    if (!verified) {
      return { status: "invalid_or_expired" as const };
    }

    const identity = await this.dataPlane.requestStore.findEmailIdentityByUserId(verified.userId);

    return identity &&
      hashNotificationDestination(identity.normalizedEmail) === verified.destinationHash
      ? { status: "confirmation_required" as const }
      : { status: "invalid_or_expired" as const };
  }

  async unsubscribeEmail(token: string) {
    const verified = await this.verifyUnsubscribeToken(token);

    if (!verified) {
      return { status: "invalid_or_expired" as const };
    }

    const identity = await this.dataPlane.requestStore.findEmailIdentityByUserId(verified.userId);

    if (
      !identity ||
      hashNotificationDestination(identity.normalizedEmail) !== verified.destinationHash
    ) {
      return { status: "invalid_or_expired" as const };
    }

    const occurredAt = this.now();
    await this.dataPlane.notifications.recordConsent({
      action: "opt_out",
      channel: "email",
      destination: identity.normalizedEmail,
      occurredAt,
      source: "one_click_unsubscribe",
      userId: verified.userId,
    });
    await this.dataPlane.notifications.suppressDestination({
      channel: "email",
      destination: identity.normalizedEmail,
      occurredAt,
      reason: "unsubscribe",
      userId: verified.userId,
    });
    await this.dataPlane.notifications.setChannelEnabled(verified.userId, "email", false);
    await this.dataPlane.notifications.consumeEmailUnsubscribeToken(verified.id, occurredAt);
    return { status: "unsubscribed" as const };
  }

  async readiness(userId: string) {
    const [email, phone] = await Promise.all([
      this.dataPlane.requestStore.findEmailIdentityByUserId(userId),
      this.dataPlane.notifications.getPhoneIdentity(userId),
    ]);
    const [emailSuppressed, emailConsented, smsSuppressed, smsConsented] = await Promise.all([
      email ? this.dataPlane.notifications.isSuppressed("email", email.normalizedEmail) : false,
      email ? this.dataPlane.notifications.hasActiveConsent("email", email.normalizedEmail) : false,
      phone ? this.dataPlane.notifications.isSuppressed("sms", phone.phoneE164) : false,
      phone ? this.dataPlane.notifications.hasActiveConsent("sms", phone.phoneE164) : false,
    ]);

    return {
      email: {
        available: this.emailTransport.configured,
        configured: this.emailTransport.configured,
        consented: emailConsented,
        identityPresent: Boolean(email),
        ready:
          this.emailTransport.configured &&
          Boolean(email?.verifiedAt) &&
          emailConsented &&
          !emailSuppressed,
        suppressed: emailSuppressed,
        verified: Boolean(email?.verifiedAt),
      },
      inApp: {
        available: true,
        configured: true,
        ready: true,
      },
      push: {
        available: false,
        configured: false,
        ready: false,
      },
      sms: {
        available: this.smsTransport.configured,
        configured: this.smsTransport.configured,
        consented: smsConsented,
        identityPresent: Boolean(phone),
        ready:
          this.smsTransport.configured &&
          Boolean(phone?.verifiedAt) &&
          smsConsented &&
          !smsSuppressed,
        suppressed: smsSuppressed,
        verified: Boolean(phone?.verifiedAt),
      },
    };
  }

  async handleSmsKeyword(phone: string, keywordValue: string) {
    const keyword = keywordValue.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
    const userId = await this.dataPlane.notifications.findUserIdByPhone(phone);
    const occurredAt = this.now();

    if (keyword === "STOP" || keyword === "UNSUBSCRIBE" || keyword === "CANCEL") {
      await this.dataPlane.notifications.recordConsent({
        action: "opt_out",
        channel: "sms",
        destination: phone,
        occurredAt,
        source: "sms_keyword",
        userId,
      });
      await this.dataPlane.notifications.suppressDestination({
        channel: "sms",
        destination: phone,
        occurredAt,
        reason: "sms_stop",
        userId,
      });
      if (userId) {
        await this.dataPlane.notifications.setChannelEnabled(userId, "sms", false);
      }
      return {
        keyword: "STOP" as const,
        message: "ClosetSearch SMS alerts are off. Reply START to opt back in.",
      };
    }

    if (keyword === "START" || keyword === "UNSTOP") {
      await this.dataPlane.notifications.recordConsent({
        action: "opt_in",
        channel: "sms",
        destination: phone,
        occurredAt,
        source: "sms_keyword",
        userId,
      });
      await this.dataPlane.notifications.releaseSmsStopSuppression(phone, occurredAt);
      if (userId) {
        const identity = await this.dataPlane.notifications.getPhoneIdentity(userId);
        await this.dataPlane.notifications.setChannelEnabled(
          userId,
          "sms",
          Boolean(identity?.verifiedAt),
        );
      }
      return {
        keyword: "START" as const,
        message: "ClosetSearch SMS alerts are on. Reply STOP to opt out.",
      };
    }

    return {
      keyword: "HELP" as const,
      message: "ClosetSearch alerts help: manage alerts in your account. Reply STOP to opt out.",
    };
  }

  async suppressProviderFailure(input: {
    channel: NotificationChannel;
    destination: string;
    providerEventId?: string;
    reason: "bounce" | "complaint" | "invalid_destination";
  }) {
    const userId =
      input.channel === "email"
        ? await this.dataPlane.notifications.findUserIdByEmail(input.destination)
        : await this.dataPlane.notifications.findUserIdByPhone(input.destination);
    const occurredAt = this.now();
    await this.dataPlane.notifications.suppressDestination({
      ...input,
      occurredAt,
      userId,
    });
    if (userId) {
      await this.dataPlane.notifications.setChannelEnabled(userId, input.channel, false);
    }
  }

  payloadDigest(rawBody: Buffer) {
    return createHash("sha256").update(rawBody).digest("hex");
  }
}
