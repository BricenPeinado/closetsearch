import type { IncomingMessage } from "node:http";
import { ApiError } from "../api-error.js";
import { requireAuth } from "../auth/auth-context.js";
import { resolvePersistenceDriver } from "../db/persistence-driver.js";
import type { AlertEventType } from "../db/postgres/repositories/notifications.js";
import { getPostgresDataPlane } from "../db/persistence-runtime.js";
import { parseJsonRequestBody, readRequestBody } from "../http/request-body.js";
import { NotificationSecurityService } from "../services/notificationSecurityService.js";
import {
  isPermanentSmsDestinationErrorCode,
  smsDestinationFailureReason,
} from "../services/notificationTransports.js";
import { verifyResendWebhook, verifyTwilioWebhook } from "../services/webhookVerification.js";
import type { RouteResult } from "./route-result.js";

const allowedWatchlistEvents = new Set<AlertEventType>([
  "auction_ending",
  "back_in_range",
  "new_listing",
  "price_drop",
]);
const permanentEmailFailureCodes = new Set([
  "invalid_email",
  "invalid_recipient",
  "recipient_address_rejected",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, statusCode = 200): RouteResult {
  return {
    body,
    headers: {
      "cache-control": "no-store",
    },
    kind: "json",
    statusCode,
  };
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderSmsWebhookTwiml(message?: string): RouteResult {
  return {
    body: message
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
      : '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    headers: {
      "cache-control": "no-store",
      "content-type": "application/xml; charset=utf-8",
    },
    kind: "text",
    statusCode: 200,
  };
}

function objectPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_request", "A JSON object is required.");
  }

  return value as Record<string, unknown>;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function optionalTimezone(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 80) {
    throw new ApiError(400, "invalid_timezone", "timezone must be a valid IANA timezone.");
  }

  const timezone = value.trim();

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new ApiError(400, "invalid_timezone", "timezone must be a valid IANA timezone.");
  }

  return timezone;
}

function watchlistSettingsPath(pathname: string) {
  const match = /^\/me\/watchlists\/([^/]+)\/alert-settings$/.exec(pathname);

  if (!match?.[1]) {
    return undefined;
  }

  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    throw new ApiError(400, "invalid_watchlist_id", "Watchlist ID is malformed.");
  }
}

function emailRecipients(payload: Record<string, unknown>) {
  const data =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {};
  const value = data.to ?? data.email ?? payload.to;

  return (Array.isArray(value) ? value : [value])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

function emailFailureCode(payload: Record<string, unknown>) {
  const data =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {};
  const failure =
    data.failed && typeof data.failed === "object" && !Array.isArray(data.failed)
      ? (data.failed as Record<string, unknown>)
      : {};
  const code = failure.reason;

  return typeof code === "string" ? code.trim().toLowerCase() : undefined;
}

export function isPermanentEmailDestinationFailure(
  eventType: string,
  payload: Record<string, unknown>,
) {
  return (
    eventType === "email.failed" && permanentEmailFailureCodes.has(emailFailureCode(payload) ?? "")
  );
}

export function isPermanentTwilioDestinationFailure(
  messageStatus: string,
  errorCode: string | undefined,
) {
  return (
    (messageStatus === "failed" || messageStatus === "undelivered") &&
    Boolean(isPermanentSmsDestinationErrorCode(errorCode))
  );
}

function requiredSecret(name: "EMAIL_WEBHOOK_SECRET" | "TWILIO_WEBHOOK_SECRET") {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new ApiError(503, "webhook_not_configured", `${name} is not configured.`);
  }

  return value;
}

function twilioSigningSecret() {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const legacyWebhookSecret = process.env.TWILIO_WEBHOOK_SECRET?.trim();

  if (!authToken) {
    throw new ApiError(503, "webhook_not_configured", "TWILIO_AUTH_TOKEN is not configured.");
  }
  if (legacyWebhookSecret && legacyWebhookSecret !== authToken) {
    throw new ApiError(
      503,
      "webhook_not_configured",
      "Twilio webhook signing configuration is inconsistent.",
    );
  }

  return authToken;
}

async function handleEmailWebhook(request: IncomingMessage) {
  const rawBody = await readRequestBody(request);
  const verification = verifyResendWebhook({
    headers: request.headers,
    rawBody,
    secret: requiredSecret("EMAIL_WEBHOOK_SECRET"),
  });

  if (!verification) {
    throw new ApiError(401, "invalid_webhook_signature", "Webhook signature is invalid.");
  }

  let payload: Record<string, unknown>;

  try {
    payload = objectPayload(JSON.parse(rawBody.toString("utf8")) as unknown);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(400, "invalid_json", "Webhook body must be valid JSON.");
  }

  const eventType = typeof payload.type === "string" ? payload.type : "";

  if (!eventType) {
    throw new ApiError(400, "invalid_webhook_event", "Webhook event type is required.");
  }

  const dataPlane = await getPostgresDataPlane();
  const service = new NotificationSecurityService(dataPlane);
  const receivedAt = new Date();
  const claim = await dataPlane.notifications.claimWebhookEvent({
    eventType,
    payloadDigest: service.payloadDigest(rawBody),
    provider: "resend",
    providerEventId: verification.providerEventId,
    receivedAt,
    staleBefore: new Date(receivedAt.getTime() - 5 * 60_000),
  });

  if (claim.status === "conflict") {
    throw new ApiError(
      409,
      "webhook_event_conflict",
      "Webhook event identity was reused with different content.",
    );
  }
  if (claim.status !== "claimed") {
    return json({ accepted: true, duplicate: true }, 202);
  }

  const reason =
    eventType === "email.bounced"
      ? ("bounce" as const)
      : eventType === "email.complained"
        ? ("complaint" as const)
        : isPermanentEmailDestinationFailure(eventType, payload)
          ? ("invalid_destination" as const)
          : undefined;

  try {
    if (reason) {
      await Promise.all(
        emailRecipients(payload).map((destination) =>
          service.suppressProviderFailure({
            channel: "email",
            destination,
            providerEventId: verification.providerEventId,
            reason,
          }),
        ),
      );
    }
    await dataPlane.notifications.completeWebhookEvent(
      "resend",
      verification.providerEventId,
      claim.claimToken,
      new Date(),
    );
  } catch (error) {
    await dataPlane.notifications.releaseWebhookEventClaim(
      "resend",
      verification.providerEventId,
      claim.claimToken,
    );
    throw error;
  }

  return json({ accepted: true, duplicate: false }, 202);
}

async function handleSmsWebhook(request: IncomingMessage, requestUrl: URL) {
  const rawBody = await readRequestBody(request);
  const parameters = new URLSearchParams(rawBody.toString("utf8"));
  const publicBase = process.env.ALERT_PUBLIC_BASE_URL?.trim();

  if (!publicBase) {
    throw new ApiError(503, "webhook_not_configured", "ALERT_PUBLIC_BASE_URL is not configured.");
  }

  const webhookUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, publicBase).toString();

  if (
    !verifyTwilioWebhook({
      headers: request.headers,
      parameters,
      secret: twilioSigningSecret(),
      url: webhookUrl,
    })
  ) {
    throw new ApiError(401, "invalid_webhook_signature", "Webhook signature is invalid.");
  }

  const providerEventId = parameters.get("MessageSid")?.trim() || parameters.get("SmsSid")?.trim();

  if (!providerEventId) {
    throw new ApiError(400, "invalid_webhook_event", "MessageSid is required.");
  }

  const dataPlane = await getPostgresDataPlane();
  const service = new NotificationSecurityService(dataPlane);
  const eventType = parameters.get("MessageStatus")?.trim() || "inbound_message";
  const webhookEventId = `${providerEventId}:${eventType}`;
  const receivedAt = new Date();
  const claim = await dataPlane.notifications.claimWebhookEvent({
    eventType,
    payloadDigest: service.payloadDigest(rawBody),
    provider: "twilio",
    providerEventId: webhookEventId,
    receivedAt,
    staleBefore: new Date(receivedAt.getTime() - 5 * 60_000),
  });

  if (claim.status === "conflict") {
    throw new ApiError(
      409,
      "webhook_event_conflict",
      "Webhook event identity was reused with different content.",
    );
  }
  if (claim.status !== "claimed") {
    return renderSmsWebhookTwiml();
  }

  const from = parameters.get("From")?.trim();
  const body = parameters.get("Body")?.trim();
  const to = parameters.get("To")?.trim();
  const failed = eventType === "failed" || eventType === "undelivered";
  const providerErrorCode = parameters.get("ErrorCode")?.trim();
  const permanentDestinationFailure =
    failed && isPermanentTwilioDestinationFailure(eventType, providerErrorCode);
  const destinationFailureReason = permanentDestinationFailure
    ? smsDestinationFailureReason(providerErrorCode)
    : undefined;
  const deliveryId = requestUrl.searchParams.get("deliveryId")?.trim();
  let keywordResult:
    | {
        keyword: "HELP" | "START" | "STOP";
        message: string;
      }
    | undefined;

  try {
    if (from && body) {
      keywordResult = await service.handleSmsKeyword(from, body);
    }
    if (destinationFailureReason && to) {
      if (destinationFailureReason === "sms_stop") {
        await service.handleSmsKeyword(to, "STOP");
      } else {
        await service.suppressProviderFailure({
          channel: "sms",
          destination: to,
          providerEventId,
          reason: "invalid_destination",
        });
      }
    }
    if (deliveryId && uuidPattern.test(deliveryId)) {
      await dataPlane.alerts.reconcileSmsDeliveryCallback({
        deliveryId,
        errorCode: providerErrorCode,
        messageStatus: eventType,
        occurredAt: new Date(),
        providerMessageId: providerEventId,
      });
    }
    await dataPlane.notifications.completeWebhookEvent(
      "twilio",
      webhookEventId,
      claim.claimToken,
      new Date(),
    );
  } catch (error) {
    await dataPlane.notifications.releaseWebhookEventClaim(
      "twilio",
      webhookEventId,
      claim.claimToken,
    );
    throw error;
  }

  return renderSmsWebhookTwiml(keywordResult?.message);
}

export async function handleNotificationRoute(
  request: IncomingMessage,
  requestUrl: URL,
): Promise<RouteResult | undefined> {
  const method = request.method ?? "GET";
  const path = requestUrl.pathname;
  const watchlistId = watchlistSettingsPath(path);
  const supported =
    path === "/me/notification-preferences" ||
    path === "/me/notification-readiness" ||
    path === "/me/phone" ||
    path === "/me/phone/verification" ||
    path === "/me/phone/verify" ||
    path === "/notifications/unsubscribe" ||
    path === "/webhooks/email" ||
    path === "/webhooks/sms" ||
    Boolean(watchlistId);

  if (!supported || resolvePersistenceDriver() !== "postgres") {
    return undefined;
  }

  if (method === "POST" && path === "/webhooks/email") {
    return handleEmailWebhook(request);
  }
  if (method === "POST" && path === "/webhooks/sms") {
    return handleSmsWebhook(request, requestUrl);
  }
  if ((method === "GET" || method === "POST") && path === "/notifications/unsubscribe") {
    const token = requestUrl.searchParams.get("token")?.trim() ?? "";
    const service = new NotificationSecurityService(await getPostgresDataPlane());
    const result =
      method === "GET"
        ? await service.inspectEmailUnsubscribe(token)
        : await service.unsubscribeEmail(token);
    return result.status === "unsubscribed" || result.status === "confirmation_required"
      ? json({
          ...result,
          ...(result.status === "confirmation_required"
            ? {
                message: "Submit a POST request to confirm email unsubscription.",
              }
            : {}),
        })
      : json(
          {
            error: "invalid_or_expired_token",
            message: "The unsubscribe link is invalid or expired.",
          },
          400,
        );
  }

  const user = requireAuth(request);
  const dataPlane = await getPostgresDataPlane();
  const service = new NotificationSecurityService(dataPlane);

  try {
    if (
      method === "GET" &&
      (path === "/me/notification-preferences" || path === "/me/notification-readiness")
    ) {
      const [deliveryReadiness, phoneIdentity, notificationPreferences] = await Promise.all([
        service.readiness(user.id),
        dataPlane.notifications.getPhoneIdentity(user.id),
        path === "/me/notification-preferences"
          ? dataPlane.notifications.getSettings(user.id)
          : undefined,
      ]);
      return json({
        deliveryReadiness,
        notificationPreferences,
        phoneIdentity,
        userId: user.id,
      });
    }

    if (method === "PATCH" && path === "/me/notification-preferences") {
      const body = objectPayload(await parseJsonRequestBody(request));
      const readiness = await service.readiness(user.id);

      if (
        body.emailEnabled === true &&
        (!readiness.email.configured || !readiness.email.verified || readiness.email.suppressed)
      ) {
        throw new ApiError(
          409,
          "email_delivery_not_ready",
          "Configure email delivery and verify a non-suppressed email address first.",
        );
      }
      if (body.smsEnabled === true && !readiness.sms.ready) {
        throw new ApiError(
          409,
          "sms_delivery_not_ready",
          "Configure SMS delivery and verify a consented, non-suppressed phone first.",
        );
      }
      if (body.pushEnabled === true) {
        throw new ApiError(409, "push_delivery_unavailable", "Push delivery is not configured.");
      }

      const [emailIdentity, phoneIdentity] = await Promise.all([
        dataPlane.requestStore.findEmailIdentityByUserId(user.id),
        dataPlane.notifications.getPhoneIdentity(user.id),
      ]);

      if (typeof body.emailEnabled === "boolean" && emailIdentity) {
        await dataPlane.notifications.recordConsent({
          action: body.emailEnabled ? "opt_in" : "opt_out",
          channel: "email",
          destination: emailIdentity.normalizedEmail,
          occurredAt: new Date(),
          source: "account_settings",
          userId: user.id,
        });
      }
      if (typeof body.smsEnabled === "boolean" && phoneIdentity) {
        await dataPlane.notifications.recordConsent({
          action: body.smsEnabled ? "opt_in" : "opt_out",
          channel: "sms",
          destination: phoneIdentity.phoneE164,
          occurredAt: new Date(),
          source: "account_settings",
          userId: user.id,
        });
      }

      const notificationPreferences = await dataPlane.notifications.updateSettings({
        emailEnabled: optionalBoolean(body.emailEnabled),
        frequency:
          body.frequency === "instant" ||
          body.frequency === "hourly" ||
          body.frequency === "daily" ||
          body.frequency === "weekly"
            ? body.frequency
            : undefined,
        inAppEnabled: optionalBoolean(body.inAppEnabled),
        pushEnabled: optionalBoolean(body.pushEnabled),
        quietHoursEnd:
          body.quietHoursEnd === null
            ? null
            : typeof body.quietHoursEnd === "string"
              ? body.quietHoursEnd.trim()
              : undefined,
        quietHoursStart:
          body.quietHoursStart === null
            ? null
            : typeof body.quietHoursStart === "string"
              ? body.quietHoursStart.trim()
              : undefined,
        smsEnabled: optionalBoolean(body.smsEnabled),
        timezone: optionalTimezone(body.timezone),
        userId: user.id,
      });
      return json({
        deliveryReadiness: await service.readiness(user.id),
        notificationPreferences,
        phoneIdentity: await dataPlane.notifications.getPhoneIdentity(user.id),
        userId: user.id,
      });
    }

    if (method === "PUT" && path === "/me/phone") {
      const body = objectPayload(await parseJsonRequestBody(request));
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";

      if (!phone) {
        throw new ApiError(400, "invalid_phone", "phone is required in E.164 format.");
      }

      return json(
        {
          phoneIdentity: await service.setPhone({
            consent: body.consent === true,
            phone,
            userId: user.id,
          }),
          userId: user.id,
        },
        201,
      );
    }

    if (method === "DELETE" && path === "/me/phone") {
      return json({
        removed: await service.removePhone(user.id),
        userId: user.id,
      });
    }

    if (method === "POST" && path === "/me/phone/verification") {
      const withinRateLimit = await dataPlane.notifications.consumeActorRateLimit({
        action: "phone_verification_request",
        at: new Date(),
        limit: 6,
        userId: user.id,
        windowMs: 10 * 60_000,
      });

      if (!withinRateLimit) {
        throw new ApiError(
          429,
          "phone_verification_rate_limited",
          "Too many verification requests. Try again later.",
        );
      }
      const result = await service.requestPhoneVerification(user.id);

      if (result.status === "delivery_unavailable") {
        throw new ApiError(409, "sms_delivery_unavailable", "SMS delivery is not configured.");
      }
      if (result.status === "phone_missing") {
        throw new ApiError(409, "phone_missing", "Add a phone number first.");
      }
      if (result.status === "rate_limited") {
        throw new ApiError(
          429,
          "phone_verification_cooldown",
          "Wait before requesting another verification code.",
        );
      }
      if (result.status === "destination_suppressed") {
        throw new ApiError(
          409,
          "sms_destination_suppressed",
          "SMS cannot be sent to this destination.",
        );
      }

      return json(result, 202);
    }

    if (method === "POST" && path === "/me/phone/verify") {
      const body = objectPayload(await parseJsonRequestBody(request));
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const result = await service.verifyPhone(user.id, code);
      return result.status === "verified"
        ? json(result)
        : result.status === "phone_in_use"
          ? json(
              {
                error: "phone_already_verified",
                message: "This phone number is already verified by another account.",
              },
              409,
            )
          : json(
              {
                error: "invalid_or_expired_code",
                message: "The verification code is invalid or expired.",
              },
              400,
            );
    }

    if (watchlistId && method === "GET") {
      const settings = await dataPlane.notifications.getWatchlistAlertSettings(
        user.id,
        watchlistId,
      );
      return settings
        ? json({ userId: user.id, watchlistAlertSettings: settings })
        : json(
            {
              error: "watchlist_not_found",
              message: "Watchlist was not found.",
            },
            404,
          );
    }

    if (watchlistId && method === "PATCH") {
      const body = objectPayload(await parseJsonRequestBody(request));
      const channels =
        body.channels && typeof body.channels === "object" && !Array.isArray(body.channels)
          ? (body.channels as Record<string, unknown>)
          : {};
      const eventTypes = Array.isArray(body.eventTypes)
        ? body.eventTypes.filter(
            (eventType): eventType is AlertEventType =>
              typeof eventType === "string" &&
              allowedWatchlistEvents.has(eventType as AlertEventType),
          )
        : undefined;

      if (Array.isArray(body.eventTypes) && eventTypes?.length !== body.eventTypes.length) {
        throw new ApiError(400, "invalid_alert_event_type", "Unknown alert event type.");
      }

      const settings = await dataPlane.notifications.updateWatchlistAlertSettings({
        email: optionalBoolean(channels.email),
        eventTypes,
        inApp: optionalBoolean(channels.inApp),
        sms: optionalBoolean(channels.sms),
        userId: user.id,
        watchlistId,
      });
      return settings
        ? json({ userId: user.id, watchlistAlertSettings: settings })
        : json(
            {
              error: "watchlist_not_found",
              message: "Watchlist was not found.",
            },
            404,
          );
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError(400, "invalid_notification_request", error.message);
    }
    throw error;
  }

  return undefined;
}
