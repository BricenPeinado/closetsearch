import type { IncomingMessage } from "node:http";
import { ApiError } from "../api-error.js";
import { getAuthConfig } from "../auth/config.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function getHeader(request: IncomingMessage, name: keyof IncomingMessage["headers"]) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function getOriginFromReferer(referer: string | undefined) {
  if (!referer) {
    return undefined;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

export function assertCsrfSafeRequest(
  request: IncomingMessage,
  env: Record<string, string | undefined> = process.env,
) {
  const method = request.method?.toUpperCase() ?? "GET";

  if (safeMethods.has(method)) {
    return;
  }

  const origin =
    getHeader(request, "origin") ?? getOriginFromReferer(getHeader(request, "referer"));
  const fetchSite = getHeader(request, "sec-fetch-site")?.toLowerCase();
  const isProduction = env.NODE_ENV === "production";
  const hasBrowserContext = Boolean(origin || fetchSite);

  if (fetchSite === "cross-site") {
    throw new ApiError(403, "csrf_rejected", "Cross-site requests are not allowed.");
  }

  if (!origin) {
    if (isProduction && hasBrowserContext) {
      throw new ApiError(403, "csrf_rejected", "A trusted request origin is required.");
    }

    return;
  }

  if (!getAuthConfig(env).allowedOrigins.has(origin)) {
    throw new ApiError(403, "csrf_rejected", "The request origin is not allowed.");
  }
}

export function buildSecurityHeaders(env: Record<string, string | undefined> = process.env) {
  return {
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "cross-origin-resource-policy": "same-site",
    "permissions-policy": "camera=(), geolocation=(), microphone=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...(env.NODE_ENV === "production"
      ? {
          "strict-transport-security": "max-age=31536000; includeSubDomains",
        }
      : {}),
  };
}
