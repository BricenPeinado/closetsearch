import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { nextAllowedDeliveryAt } from "../db/postgres/repositories/alerts.js";
import { hashNotificationDestination } from "../db/postgres/repositories/notifications.js";
import { loadProviderRuntimeConfig } from "../providers/runtime-config.js";
import {
  alertDeliveryEnabled,
  createEmailTransportFromEnvironment,
  createSmsTransportFromEnvironment,
  DeliveryTransportError,
  type EmailTransport,
  type SmsTransport,
} from "./notificationTransports.js";
import { NotificationSecurityService } from "./notificationSecurityService.js";

interface AlertDeliveryProcessorOptions {
  claimTimeoutMs?: number;
  deliveryEnabled?: boolean;
  emailTransport?: EmailTransport;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  providerEligible?: (providerId: string) => boolean;
  random?: () => number;
  smsTransport?: SmsTransport;
}

function payloadObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadString(payload: Record<string, unknown>, key: string, fallback: string) {
  return typeof payload[key] === "string" && (payload[key] as string).trim()
    ? (payload[key] as string).trim()
    : fallback;
}

function truncateCodePoints(value: string, maximum: number) {
  const points = Array.from(value);
  return points.length <= maximum
    ? value
    : `${points.slice(0, Math.max(0, maximum - 1)).join("")}…`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function publicListingUrl(
  env: Record<string, string | undefined>,
  publicListingId: string,
  fallback: string,
) {
  const base = env.ALERT_PUBLIC_BASE_URL?.trim();

  if (!base || !publicListingId) {
    return fallback;
  }

  try {
    return new URL(`/listings/${encodeURIComponent(publicListingId)}`, base).toString();
  } catch {
    return fallback;
  }
}

export function buildAlertSmsText(input: { label: string; title: string; url?: string }) {
  const prefix = `${truncateCodePoints(input.label, 48)}: ${truncateCodePoints(input.title, 180)}`;
  const url = input.url ? truncateCodePoints(input.url, 220) : "";
  return truncateCodePoints(`${prefix}${url ? ` ${url}` : ""} Reply STOP to opt out.`, 480);
}

function eventLabel(eventType: string) {
  switch (eventType) {
    case "price_drop":
      return "Price drop";
    case "auction_ending":
      return "Auction ending soon";
    case "back_in_range":
      return "Back in your price range";
    case "digest":
      return "Watchlist digest";
    default:
      return "New watchlist match";
  }
}

export function alertDeliveryRetryAt(
  now: Date,
  attemptCount: number,
  retryAfterMs?: number,
  random: () => number = Math.random,
) {
  const exponential = Math.min(5 * 60_000, 1_000 * 2 ** Math.max(0, attemptCount - 1));
  const sample = random();
  const boundedSample = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
  const jitter = Math.floor(exponential * 0.25 * boundedSample);
  return new Date(now.getTime() + Math.max(exponential + jitter, retryAfterMs ?? 0));
}

export function isProviderEligibleForAlerts(
  providerId: string,
  env: Record<string, string | undefined> = process.env,
) {
  const config = loadProviderRuntimeConfig(env);

  if (config.mode === "mock") {
    return false;
  }

  const provider =
    providerId === "grailed"
      ? config.providers.grailed
      : providerId === "depop"
        ? config.providers.depop
        : providerId === "yahoo-auctions-jp"
          ? config.providers.yahooAuctionsJp
          : providerId === "mercari-jp"
            ? config.providers.mercariJp
            : providerId === "ebay"
              ? config.providers.ebay
              : undefined;

  if (!provider?.enabled || !provider.configured || !provider.authorizationReference) {
    return false;
  }

  return providerId === "ebay" || provider.scrapingAllowed === true;
}

export class AlertDeliveryProcessor {
  private readonly claimTimeoutMs: number;
  private readonly deliveryEnabled: boolean;
  private readonly emailTransport: EmailTransport;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => Date;
  private readonly providerEligible: (providerId: string) => boolean;
  private readonly random: () => number;
  private readonly security: NotificationSecurityService;
  private readonly smsTransport: SmsTransport;

  constructor(
    private readonly dataPlane: PostgresDataPlane,
    options: AlertDeliveryProcessorOptions = {},
  ) {
    this.env = options.env ?? process.env;
    this.emailTransport = options.emailTransport ?? createEmailTransportFromEnvironment(this.env);
    this.smsTransport = options.smsTransport ?? createSmsTransportFromEnvironment(this.env);
    this.deliveryEnabled = options.deliveryEnabled ?? alertDeliveryEnabled(this.env);
    this.claimTimeoutMs =
      options.claimTimeoutMs ??
      Math.max(
        30_000,
        Math.min(3_600_000, Number(this.env.ALERT_DELIVERY_CLAIM_TIMEOUT_MS) || 5 * 60_000),
      );
    this.now = options.now ?? (() => new Date());
    this.providerEligible =
      options.providerEligible ??
      ((providerId) => isProviderEligibleForAlerts(providerId, this.env));
    this.random = options.random ?? Math.random;
    this.security = new NotificationSecurityService(dataPlane, {
      emailTransport: this.emailTransport,
      env: this.env,
      now: this.now,
      smsTransport: this.smsTransport,
    });
  }

  async processDue(limit = 25) {
    const summary = {
      delivered: 0,
      failed: 0,
      processed: 0,
      recovered: 0,
      deferred: 0,
      suppressed: 0,
    };
    const recoveryNow = this.now();
    summary.recovered = await this.dataPlane.alerts.recoverStaleDeliveryClaims(
      recoveryNow,
      new Date(recoveryNow.getTime() - this.claimTimeoutMs),
    );

    if (!this.deliveryEnabled) {
      return {
        ...summary,
        disabled: true,
      };
    }

    for (let index = 0; index < Math.max(1, Math.min(limit, 100)); index += 1) {
      const claimed = await this.dataPlane.alerts.claimDueDelivery(this.now());

      if (!claimed) {
        break;
      }

      summary.processed += 1;
      const destination = claimed.destination;
      const deliveryPolicy = claimed.deliveryPolicy;

      if (
        (claimed.channel !== "email" && claimed.channel !== "sms") ||
        !destination ||
        !claimed.userId ||
        !deliveryPolicy?.enabled ||
        !deliveryPolicy.eventEnabled ||
        !deliveryPolicy.listingEligible ||
        !this.providerEligible(deliveryPolicy.providerId) ||
        hashNotificationDestination(destination) !== claimed.destinationHash
      ) {
        await this.dataPlane.alerts.suppressDelivery(
          claimed.id,
          !deliveryPolicy?.listingEligible ||
            (deliveryPolicy && !this.providerEligible(deliveryPolicy.providerId))
            ? "Listing is no longer eligible or available for alerts."
            : !deliveryPolicy?.enabled || !deliveryPolicy?.eventEnabled
              ? "Outbound channel or event was disabled before delivery."
              : "Verified destination is missing or changed.",
        );
        summary.suppressed += 1;
        continue;
      }

      const policyNow = this.now();
      const nextPolicyAttempt = nextAllowedDeliveryAt(policyNow, {
        frequency: deliveryPolicy.frequency,
        lastDeliveredAt: deliveryPolicy.lastDeliveredAt,
        quietHoursEnd: deliveryPolicy.quietHoursEnd,
        quietHoursStart: deliveryPolicy.quietHoursStart,
        timezone: deliveryPolicy.timezone,
      });

      if (nextPolicyAttempt.getTime() > policyNow.getTime()) {
        await this.dataPlane.alerts.deferDelivery(
          claimed.id,
          nextPolicyAttempt,
          "Delivery frequency or quiet-hours policy deferred this message.",
        );
        summary.deferred += 1;
        continue;
      }

      const [suppressed, consented] = await Promise.all([
        this.dataPlane.notifications.isSuppressed(claimed.channel, destination),
        this.dataPlane.notifications.hasActiveConsent(claimed.channel, destination),
      ]);

      if (suppressed || !consented) {
        await this.dataPlane.alerts.suppressDelivery(
          claimed.id,
          suppressed ? "Destination is suppressed." : "Outbound channel consent is not active.",
        );
        summary.suppressed += 1;
        continue;
      }

      const payload = payloadObject(claimed.payload);
      const title = payloadString(payload, "title", "A listing");
      const sourceUrl = payloadString(payload, "sourceUrl", "");
      const publicListingId = payloadString(payload, "publicListingId", "");
      const label = eventLabel(claimed.eventType);
      const resultUrl = publicListingUrl(this.env, publicListingId, sourceUrl);

      try {
        const unsubscribeUrl =
          claimed.channel === "email"
            ? await this.security.unsubscribeUrl(
                claimed.userId,
                destination,
                claimed.idempotencyKey,
              )
            : undefined;
        const result =
          claimed.channel === "email"
            ? await this.emailTransport.send({
                headers: {
                  "List-Unsubscribe": `<${unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
                html:
                  `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">` +
                  `<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(label)}</p>` +
                  `<h1 style="font-size:24px;line-height:1.2">${escapeHtml(title)}</h1>` +
                  `<p><a href="${escapeHtml(resultUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;text-decoration:none">View listing on ClosetSearch</a></p>` +
                  `<p style="font-size:12px;color:#666">Manage alerts in your ClosetSearch account or <a href="${escapeHtml(unsubscribeUrl ?? "")}">unsubscribe</a>.</p>` +
                  `</div>`,
                idempotencyKey: claimed.idempotencyKey,
                subject: `${label}: ${title}`,
                text: `${label}\n\n${title}\n${resultUrl}\n\nManage alerts in ClosetSearch or unsubscribe: ${unsubscribeUrl}`,
                to: destination,
              })
            : await this.smsTransport.send({
                deliveryId: claimed.id,
                idempotencyKey: claimed.idempotencyKey,
                text: buildAlertSmsText({
                  label,
                  title,
                  url: publicListingUrl(this.env, publicListingId, resultUrl),
                }),
                to: destination,
              });
        await this.dataPlane.alerts.markDeliveryDelivered(
          claimed.id,
          this.now(),
          result.providerMessageId,
          result.providerResponse,
        );
        summary.delivered += 1;
      } catch (error) {
        const failure =
          error instanceof DeliveryTransportError
            ? error
            : new DeliveryTransportError("Delivery transport failed.", "delivery_failed", false);
        const failedAt = this.now();
        if (claimed.channel === "sms" && failure.suppressionReason === "sms_stop") {
          await this.security.handleSmsKeyword(destination, "STOP");
        } else if (claimed.channel === "sms" && failure.destinationInvalid) {
          await this.security.suppressProviderFailure({
            channel: "sms",
            destination,
            reason: "invalid_destination",
          });
        }
        await this.dataPlane.alerts.failDelivery(claimed.id, {
          errorCode: failure.code,
          errorMessage: failure.message,
          failedAt,
          retryAt: alertDeliveryRetryAt(
            failedAt,
            claimed.attemptCount,
            failure.retryAfterMs,
            this.random,
          ),
          terminal: failure.terminal,
        });
        summary.failed += 1;
      }
    }

    return {
      ...summary,
      disabled: false,
    };
  }
}
