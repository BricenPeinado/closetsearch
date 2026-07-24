import type { PremiumAccess } from "@closetsearch/shared";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { ApiError } from "../api-error.js";

export const premiumAnalyticsFeature = "market_analytics";

export interface EntitlementActor {
  isAdmin: boolean;
  userId: string;
}

function isDevelopmentOnly(metadata: Record<string, unknown>) {
  return metadata.developmentOnly === true;
}

export class PersistedEntitlementService {
  constructor(
    private readonly dataPlane: PostgresDataPlane,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async hasFeature(userId: string, featureKey: string) {
    const active = await this.dataPlane.entitlements.listActive(userId, this.now());

    return active.some(
      (entitlement) =>
        entitlement.featureKey === featureKey &&
        !(this.env.NODE_ENV === "production" && isDevelopmentOnly(entitlement.metadata)),
    );
  }

  async getPremiumAccess(userId: string): Promise<PremiumAccess> {
    const active = await this.dataPlane.entitlements.listActive(userId, this.now());
    const matching = active.find(
      (entitlement) =>
        entitlement.featureKey === premiumAnalyticsFeature &&
        !(this.env.NODE_ENV === "production" && isDevelopmentOnly(entitlement.metadata)),
    );

    if (!matching) {
      return {
        isPremium: false,
        planName: "Free",
        userId,
      };
    }

    return {
      expiresAt: matching.endsAt?.toISOString(),
      isPremium: true,
      planName: isDevelopmentOnly(matching.metadata)
        ? "Development entitlement — no billing"
        : "Premium",
      userId,
    };
  }

  async grantDevelopmentEntitlement(
    actor: EntitlementActor,
    input: {
      endsAt?: Date;
      featureKey?: string;
      targetUserId: string;
    },
  ) {
    if (this.env.NODE_ENV === "production") {
      throw new ApiError(
        403,
        "development_entitlements_forbidden",
        "Development entitlements are disabled in production.",
      );
    }

    if (this.env.ENTITLEMENT_ADMIN_DEVELOPMENT_ENABLED?.trim().toLowerCase() !== "true") {
      throw new ApiError(
        403,
        "development_entitlements_disabled",
        "Development entitlement grants are not enabled.",
      );
    }

    if (!actor.isAdmin) {
      throw new ApiError(
        403,
        "admin_required",
        "An administrator is required to grant a development entitlement.",
      );
    }

    const startsAt = this.now();
    const endsAt = input.endsAt ?? new Date(startsAt.getTime() + 30 * 86_400_000);

    if (endsAt <= startsAt) {
      throw new ApiError(
        400,
        "invalid_entitlement_expiry",
        "Development entitlement expiry must be in the future.",
      );
    }

    return this.dataPlane.database.withTransaction(async (client) => {
      const entitlement = await this.dataPlane.entitlements.grant(
        {
          endsAt,
          externalReference: `development:${input.targetUserId}`,
          featureKey: input.featureKey ?? premiumAnalyticsFeature,
          metadata: {
            developmentOnly: true,
            grantedByAdminUserId: actor.userId,
            warning: "No billing provider is attached to this entitlement.",
          },
          provider: "admin",
          startsAt,
          userId: input.targetUserId,
        },
        client,
      );

      await client.query(
        `INSERT INTO audit_records (
           actor_type,
           actor_id,
           action,
           resource_type,
           resource_id,
           metadata
         ) VALUES (
           'admin',
           $1,
           'development_entitlement_granted',
           'premium_entitlement',
           $2,
           $3::jsonb
         )`,
        [
          actor.userId,
          entitlement.id,
          JSON.stringify({
            developmentOnly: true,
            featureKey: entitlement.featureKey,
            targetUserId: input.targetUserId,
          }),
        ],
      );

      return entitlement;
    });
  }
}
