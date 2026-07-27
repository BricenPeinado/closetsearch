import { Buffer } from "node:buffer";

export interface EmailDeliveryMessage {
  headers?: Record<string, string>;
  html?: string;
  idempotencyKey: string;
  subject: string;
  text: string;
  to: string;
}

export interface SmsDeliveryMessage {
  deliveryId?: string;
  idempotencyKey: string;
  text: string;
  to: string;
}

export interface TransportDeliveryResult {
  providerMessageId?: string;
  providerResponse?: Record<string, unknown>;
  status: "accepted";
}

export interface EmailTransport {
  readonly kind: "capture" | "disabled" | "resend";
  readonly configured: boolean;
  send(message: EmailDeliveryMessage): Promise<TransportDeliveryResult>;
}

export interface SmsTransport {
  readonly kind: "capture" | "disabled" | "twilio";
  readonly configured: boolean;
  send(message: SmsDeliveryMessage): Promise<TransportDeliveryResult>;
}

export class DeliveryTransportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly terminal: boolean,
    readonly retryAfterMs?: number,
    readonly destinationInvalid = false,
    readonly suppressionReason?: "invalid_destination" | "sms_stop",
  ) {
    super(message);
    this.name = "DeliveryTransportError";
  }
}

const invalidSmsDestinationErrorCodes = new Set(["21211", "21614"]);

export function isPermanentSmsDestinationErrorCode(code: string | undefined) {
  return Boolean(code && (invalidSmsDestinationErrorCodes.has(code) || code === "21610"));
}

export function smsDestinationFailureReason(code: string | undefined) {
  return code === "21610"
    ? ("sms_stop" as const)
    : code && invalidSmsDestinationErrorCodes.has(code)
      ? ("invalid_destination" as const)
      : undefined;
}

function boundedResponse(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 1_000);
}

function parseRetryAfter(value: string | null) {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(3_600_000, Math.round(seconds * 1_000));
  }

  const at = new Date(value);
  return Number.isNaN(at.getTime())
    ? undefined
    : Math.min(3_600_000, Math.max(0, at.getTime() - Date.now()));
}

function transportMode(value: string | undefined, allowed: ReadonlySet<string>, name: string) {
  const mode = value?.trim().toLowerCase() || "disabled";

  if (!allowed.has(mode)) {
    throw new TypeError(`${name} must be one of ${Array.from(allowed).join(", ")}.`);
  }

  return mode;
}

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();

  if (!normalized) {
    throw new TypeError(`${name} is required for the configured delivery transport.`);
  }

  return normalized;
}

function disabledError(channel: string) {
  return new DeliveryTransportError(
    `${channel} delivery is not configured.`,
    "transport_disabled",
    true,
  );
}

export class DisabledEmailTransport implements EmailTransport {
  readonly configured = false;
  readonly kind = "disabled" as const;

  async send(_message: EmailDeliveryMessage): Promise<TransportDeliveryResult> {
    throw disabledError("Email");
  }
}

export class DisabledSmsTransport implements SmsTransport {
  readonly configured = false;
  readonly kind = "disabled" as const;

  async send(_message: SmsDeliveryMessage): Promise<TransportDeliveryResult> {
    throw disabledError("SMS");
  }
}

export class CaptureEmailTransport implements EmailTransport {
  readonly configured = true;
  readonly kind = "capture" as const;
  readonly messages: EmailDeliveryMessage[] = [];

  async send(message: EmailDeliveryMessage): Promise<TransportDeliveryResult> {
    this.messages.push(structuredClone(message));
    return {
      providerMessageId: `capture-email-${this.messages.length}`,
      providerResponse: { accepted: true },
      status: "accepted",
    };
  }
}

export class CaptureSmsTransport implements SmsTransport {
  readonly configured = true;
  readonly kind = "capture" as const;
  readonly messages: SmsDeliveryMessage[] = [];

  async send(message: SmsDeliveryMessage): Promise<TransportDeliveryResult> {
    if (Array.from(message.text).length > 1_600) {
      throw new DeliveryTransportError(
        "SMS message exceeds the provider body limit.",
        "sms_body_too_long",
        true,
      );
    }

    this.messages.push(structuredClone(message));
    return {
      providerMessageId: `capture-sms-${this.messages.length}`,
      providerResponse: { accepted: true },
      status: "accepted",
    };
  }
}

export class ResendEmailTransport implements EmailTransport {
  readonly configured = true;
  readonly kind = "resend" as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async send(message: EmailDeliveryMessage): Promise<TransportDeliveryResult> {
    let response: Response;

    try {
      response = await this.fetchImplementation("https://api.resend.com/emails", {
        body: JSON.stringify({
          from: this.from,
          headers: message.headers,
          html: message.html,
          subject: message.subject,
          text: message.text,
          to: [message.to],
        }),
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": message.idempotencyKey,
        },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DeliveryTransportError(
        "Email provider request failed.",
        "email_provider_unreachable",
        false,
      );
    }

    const responseBody = boundedResponse(await response.text());

    if (!response.ok) {
      throw new DeliveryTransportError(
        `Email provider returned HTTP ${response.status}.`,
        `email_provider_${response.status}`,
        response.status >= 400 && response.status < 500 && response.status !== 429,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    let parsed: Record<string, unknown> = {};

    try {
      parsed = responseBody ? (JSON.parse(responseBody) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }

    return {
      providerMessageId: typeof parsed.id === "string" ? parsed.id : undefined,
      providerResponse: {
        accepted: true,
      },
      status: "accepted",
    };
  }
}

export class TwilioSmsTransport implements SmsTransport {
  readonly configured = true;
  readonly kind = "twilio" as const;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly statusCallback?: string,
  ) {}

  async send(message: SmsDeliveryMessage): Promise<TransportDeliveryResult> {
    const statusCallback = this.statusCallback ? new URL(this.statusCallback) : undefined;

    if (Array.from(message.text).length > 1_600) {
      throw new DeliveryTransportError(
        "SMS message exceeds the provider body limit.",
        "sms_body_too_long",
        true,
      );
    }

    if (statusCallback && message.deliveryId) {
      statusCallback.searchParams.set("deliveryId", message.deliveryId);
    }

    const body = new URLSearchParams({
      Body: message.text,
      From: this.from,
      To: message.to,
      ...(statusCallback
        ? {
            StatusCallback: statusCallback.toString(),
          }
        : {}),
    });
    let response: Response;

    try {
      response = await this.fetchImplementation(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
        {
          body,
          headers: {
            authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new DeliveryTransportError(
        "SMS provider outcome is unknown and requires reconciliation.",
        "sms_provider_outcome_unknown",
        true,
      );
    }

    const responseBody = boundedResponse(await response.text());

    if (!response.ok) {
      let providerErrorCode: string | undefined;

      try {
        const parsed = responseBody ? (JSON.parse(responseBody) as Record<string, unknown>) : {};
        providerErrorCode =
          typeof parsed.code === "number" || typeof parsed.code === "string"
            ? String(parsed.code)
            : undefined;
      } catch {
        providerErrorCode = undefined;
      }
      const suppressionReason = smsDestinationFailureReason(providerErrorCode);
      const destinationInvalid = suppressionReason === "invalid_destination";
      const ambiguous = response.status >= 500;

      throw new DeliveryTransportError(
        ambiguous
          ? "SMS provider outcome is unknown and requires reconciliation."
          : `SMS provider returned HTTP ${response.status}.`,
        suppressionReason
          ? `sms_provider_${providerErrorCode}`
          : ambiguous
            ? "sms_provider_outcome_unknown"
            : `sms_provider_${response.status}`,
        ambiguous ||
          Boolean(suppressionReason) ||
          (response.status >= 400 && response.status < 500 && response.status !== 429),
        parseRetryAfter(response.headers.get("retry-after")),
        destinationInvalid,
        suppressionReason,
      );
    }

    let parsed: Record<string, unknown> = {};

    try {
      parsed = responseBody ? (JSON.parse(responseBody) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }

    return {
      providerMessageId: typeof parsed.sid === "string" ? parsed.sid : undefined,
      providerResponse: {
        accepted: true,
        status: typeof parsed.status === "string" ? parsed.status : undefined,
      },
      status: "accepted",
    };
  }
}

export function createEmailTransportFromEnvironment(
  env: Record<string, string | undefined> = process.env,
  fetchImplementation: typeof fetch = fetch,
): EmailTransport {
  const mode = transportMode(
    env.EMAIL_TRANSPORT,
    new Set(["capture", "disabled", "resend"]),
    "EMAIL_TRANSPORT",
  );

  if (mode === "disabled") {
    return new DisabledEmailTransport();
  }
  if (mode === "capture") {
    if (env.NODE_ENV === "production") {
      throw new TypeError("EMAIL_TRANSPORT=capture is not allowed in production.");
    }

    return new CaptureEmailTransport();
  }

  return new ResendEmailTransport(
    required(env.RESEND_API_KEY, "RESEND_API_KEY"),
    required(env.EMAIL_FROM_ADDRESS, "EMAIL_FROM_ADDRESS"),
    fetchImplementation,
  );
}

export function createSmsTransportFromEnvironment(
  env: Record<string, string | undefined> = process.env,
  fetchImplementation: typeof fetch = fetch,
): SmsTransport {
  const mode = transportMode(
    env.SMS_TRANSPORT,
    new Set(["capture", "disabled", "twilio"]),
    "SMS_TRANSPORT",
  );

  if (mode === "disabled") {
    return new DisabledSmsTransport();
  }
  if (mode === "capture") {
    if (env.NODE_ENV === "production") {
      throw new TypeError("SMS_TRANSPORT=capture is not allowed in production.");
    }

    return new CaptureSmsTransport();
  }

  return new TwilioSmsTransport(
    required(env.TWILIO_ACCOUNT_SID, "TWILIO_ACCOUNT_SID"),
    required(env.TWILIO_AUTH_TOKEN, "TWILIO_AUTH_TOKEN"),
    required(env.TWILIO_FROM_NUMBER, "TWILIO_FROM_NUMBER"),
    fetchImplementation,
    new URL(
      "/webhooks/sms",
      required(env.ALERT_PUBLIC_BASE_URL, "ALERT_PUBLIC_BASE_URL"),
    ).toString(),
  );
}

export function alertDeliveryEnabled(env: Record<string, string | undefined> = process.env) {
  return ["1", "true", "yes", "on"].includes(
    env.ALERT_DELIVERY_ENABLED?.trim().toLowerCase() ?? "",
  );
}
