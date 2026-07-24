import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { ApiError } from "../api-error.js";
import { getOptionalAuthContext } from "../auth/auth-context.js";
import { resolvePersistenceDriver } from "../db/persistence-driver.js";
import { getPostgresDataPlane, PersistenceNotReadyError } from "../db/persistence-runtime.js";
import { parseJsonRequestBody } from "../http/request-body.js";
import { FixedWindowRateLimiter, getRequestIpHint } from "../http/rate-limit.js";
import { DurableEngagementService } from "../services/durableEngagementService.js";

const privacySessionHeader = "x-privacy-session-id";
const engagementSessionRateLimiter = new FixedWindowRateLimiter({
  limit: 120,
  windowMs: 60_000,
});
const engagementIpRateLimiter = new FixedWindowRateLimiter({
  limit: 600,
  windowMs: 60_000,
});

export interface EngagementRouteResult {
  body: unknown;
  statusCode: number;
}

function getPrivacySessionId(request: IncomingMessage) {
  const rawValue = request.headers?.[privacySessionHeader];
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

  if (typeof value !== "string" || value.trim().length < 16 || value.trim().length > 128) {
    throw new ApiError(
      400,
      "invalid_privacy_session",
      "X-Privacy-Session-ID must contain an opaque 16 to 128 character identifier.",
    );
  }

  return value.trim();
}

function privacySessionRateLimitKey(value: string) {
  return createHash("sha256").update("engagement-rate-limit-v1:").update(value).digest("hex");
}

export function resetEngagementRateLimitsForTests() {
  engagementIpRateLimiter.reset();
  engagementSessionRateLimiter.reset();
}

export function enforceEngagementRateLimit(request: IncomingMessage, privacySessionId: string) {
  engagementSessionRateLimiter.consume(`session:${privacySessionRateLimitKey(privacySessionId)}`);
  engagementIpRateLimiter.consume(`ip:${getRequestIpHint(request)}`);
}

async function createDurableEngagementService() {
  if (resolvePersistenceDriver() !== "postgres") {
    throw new ApiError(
      503,
      "durable_events_unavailable",
      "Durable engagement storage is not available in this environment.",
    );
  }

  try {
    return new DurableEngagementService(await getPostgresDataPlane());
  } catch (error) {
    if (error instanceof PersistenceNotReadyError) {
      throw new ApiError(
        503,
        "durable_events_unavailable",
        "Durable engagement storage is not available in this environment.",
      );
    }

    throw error;
  }
}

export async function handleEngagementRoute(
  request: IncomingMessage,
  requestUrl: URL,
): Promise<EngagementRouteResult | undefined> {
  if ((request.method ?? "GET") !== "POST" || requestUrl.pathname !== "/events") {
    return undefined;
  }

  const privacySessionId = getPrivacySessionId(request);
  enforceEngagementRateLimit(request, privacySessionId);
  const rawPayload = await parseJsonRequestBody(request);
  const service = await createDurableEngagementService();
  const result = await service.recordClientEvent(
    {
      privacySessionId,
      userId: getOptionalAuthContext(request)?.user.id,
    },
    rawPayload,
  );

  return {
    body: result,
    statusCode: 202,
  };
}
