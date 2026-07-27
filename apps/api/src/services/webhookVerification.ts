import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

const maximumWebhookClockSkewSeconds = 5 * 60;

function firstHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqualBase64(left: string, right: string) {
  let leftBuffer: Buffer;
  let rightBuffer: Buffer;

  try {
    leftBuffer = Buffer.from(left, "base64");
    rightBuffer = Buffer.from(right, "base64");
  } catch {
    return false;
  }

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function resendSecretKey(secret: string) {
  const normalized = secret.trim();
  const encoded = normalized.startsWith("whsec_") ? normalized.slice(6) : normalized;

  try {
    const decoded = Buffer.from(encoded, "base64");
    return decoded.length >= 16 ? decoded : Buffer.from(normalized, "utf8");
  } catch {
    return Buffer.from(normalized, "utf8");
  }
}

export function signResendWebhook(
  rawBody: Buffer,
  secret: string,
  webhookId: string,
  timestampSeconds: number,
) {
  return createHmac("sha256", resendSecretKey(secret))
    .update(`${webhookId}.${timestampSeconds}.`)
    .update(rawBody)
    .digest("base64");
}

export function verifyResendWebhook(input: {
  headers: IncomingHttpHeaders;
  now?: Date;
  rawBody: Buffer;
  secret: string;
}) {
  const webhookId = firstHeader(input.headers, "svix-id")?.trim();
  const timestampValue = firstHeader(input.headers, "svix-timestamp")?.trim();
  const signatures = firstHeader(input.headers, "svix-signature")
    ?.split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const timestampSeconds = Number(timestampValue);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);

  if (
    !webhookId ||
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > maximumWebhookClockSkewSeconds ||
    !signatures?.length
  ) {
    return undefined;
  }

  const expected = signResendWebhook(input.rawBody, input.secret, webhookId, timestampSeconds);
  const verified = signatures.some((signature) => {
    const [version, value] = signature.split(",", 2);
    return version === "v1" && Boolean(value) && safeEqualBase64(value as string, expected);
  });

  return verified
    ? {
        providerEventId: webhookId,
        timestamp: new Date(timestampSeconds * 1_000),
      }
    : undefined;
}

function twilioSignaturePayload(url: string, parameters: URLSearchParams) {
  const keys = Array.from(new Set(parameters.keys())).sort();
  return keys.reduce((payload, key) => {
    const values = parameters.getAll(key).sort();
    return values.reduce((current, value) => `${current}${key}${value}`, payload);
  }, url);
}

export function signTwilioWebhook(url: string, parameters: URLSearchParams, secret: string) {
  return createHmac("sha1", secret.trim())
    .update(twilioSignaturePayload(url, parameters), "utf8")
    .digest("base64");
}

export function verifyTwilioWebhook(input: {
  headers: IncomingHttpHeaders;
  parameters: URLSearchParams;
  secret: string;
  url: string;
}) {
  const signature = firstHeader(input.headers, "x-twilio-signature")?.trim();

  if (!signature) {
    return false;
  }

  return safeEqualBase64(signature, signTwilioWebhook(input.url, input.parameters, input.secret));
}
