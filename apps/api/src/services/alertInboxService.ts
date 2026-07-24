import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { ApiError } from "../api-error.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseMutationPayload(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new ApiError(400, "invalid_alert_action", "Alert action body must be an object.");
  }

  const payload = rawPayload as Record<string, unknown>;

  if ("userId" in payload || "user_id" in payload) {
    throw new ApiError(
      400,
      "spoofed_user_id",
      "User identity is derived from the authenticated session.",
    );
  }

  if (typeof payload.alertMatchId !== "string" || !uuidPattern.test(payload.alertMatchId)) {
    throw new ApiError(400, "invalid_alert_action", "alertMatchId must be a UUID.");
  }

  return payload.alertMatchId.toLowerCase();
}

export class AlertInboxService {
  constructor(
    private readonly dataPlane: PostgresDataPlane,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(userId: string) {
    const alerts = await this.dataPlane.alerts.listInbox(userId);

    return {
      alerts,
      unseenCount: alerts.filter((alert) => alert.state === "unseen").length,
    };
  }

  async markSeen(userId: string, rawPayload: unknown) {
    const alertMatchId = parseMutationPayload(rawPayload);
    const updated = await this.dataPlane.alerts.markSeen(userId, alertMatchId, this.now());

    if (!updated) {
      throw new ApiError(404, "alert_not_found", "Alert was not found.");
    }

    return {
      alertMatchId,
      state: "seen" as const,
    };
  }

  async dismiss(userId: string, rawPayload: unknown) {
    const alertMatchId = parseMutationPayload(rawPayload);
    const updated = await this.dataPlane.alerts.dismiss(userId, alertMatchId, this.now());

    if (!updated) {
      throw new ApiError(404, "alert_not_found", "Alert was not found.");
    }

    return {
      alertMatchId,
      state: "dismissed" as const,
    };
  }
}
