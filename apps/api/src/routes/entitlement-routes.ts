import type { IncomingMessage } from "node:http";
import { ApiError } from "../api-error.js";
import { requireAuth } from "../auth/auth-context.js";
import { resolvePersistenceDriver } from "../db/persistence-driver.js";
import { getPostgresDataPlane } from "../db/persistence-runtime.js";
import { parseJsonRequestBody } from "../http/request-body.js";
import { PersistedEntitlementService } from "../services/entitlementService.js";
import type { RouteResult } from "./route-result.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(payload: Record<string, unknown>, name: string) {
  const value = payload[name];

  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ApiError(400, "invalid_request", `${name} must be a UUID.`);
  }

  return value.toLowerCase();
}

function optionalExpiry(payload: Record<string, unknown>) {
  if (payload.endsAt === undefined || payload.endsAt === null) {
    return undefined;
  }

  if (typeof payload.endsAt !== "string") {
    throw new ApiError(
      400,
      "invalid_request",
      "endsAt must be an ISO timestamp.",
    );
  }

  const endsAt = new Date(payload.endsAt);

  if (Number.isNaN(endsAt.getTime())) {
    throw new ApiError(
      400,
      "invalid_request",
      "endsAt must be an ISO timestamp.",
    );
  }

  return endsAt;
}

export async function handleEntitlementRoute(
  request: IncomingMessage,
  requestUrl: URL,
): Promise<RouteResult | undefined> {
  if (
    (request.method ?? "GET") !== "POST" ||
    requestUrl.pathname !== "/admin/development-entitlements"
  ) {
    return undefined;
  }

  const actor = requireAuth(request);

  if (resolvePersistenceDriver() !== "postgres") {
    throw new ApiError(
      503,
      "persisted_entitlements_unavailable",
      "Persisted entitlements require PostgreSQL.",
    );
  }

  const rawPayload = await parseJsonRequestBody(request);

  if (
    !rawPayload ||
    typeof rawPayload !== "object" ||
    Array.isArray(rawPayload)
  ) {
    throw new ApiError(400, "invalid_request", "A JSON object is required.");
  }

  const payload = rawPayload as Record<string, unknown>;

  if ("userId" in payload || "user_id" in payload) {
    throw new ApiError(
      400,
      "spoofed_actor_id",
      "Administrator identity is derived from the authenticated session.",
    );
  }

  const targetUserId = requiredUuid(payload, "targetUserId");
  const featureKey =
    typeof payload.featureKey === "string"
      ? payload.featureKey.trim()
      : undefined;

  if (featureKey && featureKey.length > 120) {
    throw new ApiError(
      400,
      "invalid_request",
      "featureKey must be at most 120 characters.",
    );
  }

  const dataPlane = await getPostgresDataPlane();
  const adminIdentity = await dataPlane.database.query(
    `SELECT 1
     FROM user_identities
     WHERE user_id = $1
       AND identity_type = 'admin'
       AND verified_at IS NOT NULL
     LIMIT 1`,
    [actor.id],
  );
  const entitlement = await new PersistedEntitlementService(
    dataPlane,
  ).grantDevelopmentEntitlement(
    {
      isAdmin: adminIdentity.rowCount === 1,
      userId: actor.id,
    },
    {
      endsAt: optionalExpiry(payload),
      featureKey: featureKey || undefined,
      targetUserId,
    },
  );

  return {
    body: {
      entitlement,
      warning:
        "Development entitlement only. No billing provider or subscription is attached.",
    },
    kind: "json",
    statusCode: 201,
  };
}
