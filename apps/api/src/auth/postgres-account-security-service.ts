import { createHash, randomBytes } from "node:crypto";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import type { PostgresRequestStore } from "../db/postgres/request-store.js";
import {
  RequestStoreError,
  type AccountTokenPurpose,
  type EmailIdentityRecord,
} from "../db/postgres/request-store-types.js";
import { AccountSecurityError } from "./account-security-error.js";
import { getAuthConfig } from "./config.js";
import { normalizeEmailAddress } from "./email-address.js";
import {
  disabledAccountEmailSender,
  type AccountEmailDelivery,
  type AccountEmailKind,
  type AccountEmailSender,
} from "./email-sender.js";
import { hashPassword } from "./password-service.js";
import { assertPasswordPolicy, type PasswordPolicyOptions } from "./password-policy.js";

const defaultTokenTtlMs: Record<AccountTokenPurpose, number> = {
  account_export: 15 * 60 * 1_000,
  email_verification: 24 * 60 * 60 * 1_000,
  password_reset: 30 * 60 * 1_000,
};

const maximumRawTokenLength = 1_024;

export interface PostgresAccountSecurityServiceOptions {
  actionBaseUrl?: string;
  emailSender?: AccountEmailSender;
  generateRawToken?: () => string;
  nodeEnv?: string;
  now?: () => Date;
  passwordPolicy?: PasswordPolicyOptions;
  tokenPepper?: string;
  tokenTtlMs?: Partial<Record<AccountTokenPurpose, number>>;
}

export type PostgresVerificationRequestResult =
  | {
      status: "already_verified";
    }
  | {
      delivery: AccountEmailDelivery;
      expiresAt: string;
      status: "requested";
    };

export type PostgresPasswordResetResult =
  | {
      sessionsRevoked: number;
      status: "password_reset";
      userId: string;
    }
  | {
      status: "invalid_or_expired";
    };

export interface PostgresAccountExportRequestResult {
  delivery: AccountEmailDelivery;
  expiresAt: string;
  status: "requested";
}

function validateActionBaseUrl(value: string, nodeEnv: string | undefined) {
  const url = new URL(value);
  const isLocalDevelopmentUrl =
    nodeEnv !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (url.protocol !== "https:" && !isLocalDevelopmentUrl) {
    throw new TypeError("Account action base URL must use HTTPS outside local development.");
  }

  return url;
}

function validateTokenTtl(purpose: AccountTokenPurpose, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000) {
    throw new TypeError(
      `Account token TTL for ${purpose} must be an integer of at least 1000 milliseconds.`,
    );
  }

  return value;
}

function isRawTokenCandidate(value: string) {
  return value.length > 0 && value.length <= maximumRawTokenLength;
}

/**
 * PostgreSQL-backed account recovery and lifecycle operations.
 *
 * Raw one-time tokens exist only long enough to be placed in an action URL sent
 * through the configured email adapter. The database receives a
 * purpose-separated digest, so a digest issued for one workflow cannot be
 * replayed against another workflow.
 */
export class PostgresAccountSecurityService {
  private readonly actionBaseUrl: URL;
  private readonly emailSender: AccountEmailSender;
  private readonly generateRawToken: () => string;
  private readonly now: () => Date;
  private readonly passwordPolicy: PasswordPolicyOptions;
  private readonly requestStore: PostgresRequestStore;
  private readonly tokenPepper: string;
  private readonly tokenTtlMs: Record<AccountTokenPurpose, number>;

  constructor(
    dataPlane: Pick<PostgresDataPlane, "requestStore">,
    options: PostgresAccountSecurityServiceOptions = {},
  ) {
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;

    if (options.emailSender && !options.actionBaseUrl) {
      throw new TypeError(
        "A configured email sender requires an explicit account action base URL.",
      );
    }

    this.actionBaseUrl = validateActionBaseUrl(
      options.actionBaseUrl ??
        (nodeEnv === "production" ? "https://account-actions.invalid" : "http://localhost:5173"),
      nodeEnv,
    );
    this.emailSender = options.emailSender ?? disabledAccountEmailSender;
    this.generateRawToken =
      options.generateRawToken ?? (() => randomBytes(32).toString("base64url"));
    this.now = options.now ?? (() => new Date());
    this.passwordPolicy = options.passwordPolicy ?? {};
    this.requestStore = dataPlane.requestStore;
    this.tokenPepper = (options.tokenPepper ?? getAuthConfig().tokenPepper).trim();

    if (nodeEnv === "production" && this.tokenPepper.length < 32) {
      throw new TypeError(
        "AUTH_SESSION_PEPPER must contain at least 32 characters before PostgreSQL account tokens can be issued.",
      );
    }

    this.tokenTtlMs = {
      account_export: validateTokenTtl(
        "account_export",
        options.tokenTtlMs?.account_export ?? defaultTokenTtlMs.account_export,
      ),
      email_verification: validateTokenTtl(
        "email_verification",
        options.tokenTtlMs?.email_verification ?? defaultTokenTtlMs.email_verification,
      ),
      password_reset: validateTokenTtl(
        "password_reset",
        options.tokenTtlMs?.password_reset ?? defaultTokenTtlMs.password_reset,
      ),
    };
  }

  async setEmailIdentity(userId: string, emailValue: string) {
    const user = await this.requestStore.findUserById(userId);

    if (!user) {
      throw new AccountSecurityError("user_not_found", "User not found.");
    }

    const { email, normalizedEmail } = normalizeEmailAddress(emailValue);

    try {
      return await this.requestStore.withTransaction(async (store) => {
        const claimedIdentity = await store.findEmailIdentityByNormalizedEmail(normalizedEmail);

        if (claimedIdentity && claimedIdentity.userId !== userId) {
          throw new AccountSecurityError("email_in_use", "That email address is already in use.");
        }

        return store.upsertEmailIdentity({
          createdAt: this.now(),
          email,
          userId,
        });
      });
    } catch (error) {
      if (error instanceof RequestStoreError && error.code === "email_in_use") {
        throw new AccountSecurityError("email_in_use", "That email address is already in use.");
      }

      throw error;
    }
  }

  async requestEmailVerification(userId: string): Promise<PostgresVerificationRequestResult> {
    const identity = await this.requestStore.findEmailIdentityByUserId(userId);

    if (!identity) {
      throw new AccountSecurityError(
        "email_missing",
        "Add an email address before requesting verification.",
      );
    }

    if (identity.verifiedAt) {
      return {
        status: "already_verified",
      };
    }

    const issuedToken = await this.issueToken({
      emailIdentityId: identity.id,
      purpose: "email_verification",
      userId,
    });
    const delivery = await this.sendActionEmail(
      identity,
      "email_verification",
      issuedToken.rawToken,
      issuedToken.expiresAt,
      "/verify-email",
    );

    return {
      delivery,
      expiresAt: issuedToken.expiresAt,
      status: "requested",
    };
  }

  async verifyEmail(rawToken: string) {
    if (!isRawTokenCandidate(rawToken)) {
      return {
        status: "invalid_or_expired" as const,
      };
    }

    const verifiedAt = this.now();
    const tokenHash = this.hashToken(rawToken, "email_verification");

    return this.requestStore.withTransaction(async (store) => {
      const token = await store.consumeActiveAccountToken(
        tokenHash,
        "email_verification",
        verifiedAt,
      );

      if (!token?.emailIdentityId) {
        return {
          status: "invalid_or_expired" as const,
        };
      }

      const identity = await store.findEmailIdentityById(token.emailIdentityId);

      if (!identity || identity.userId !== token.userId) {
        throw new Error("Verification token identity invariant failed.");
      }

      const verifiedIdentity = await store.markEmailIdentityVerified(
        identity.id,
        identity.userId,
        verifiedAt,
      );

      if (!verifiedIdentity) {
        throw new Error("Verification identity disappeared during transaction.");
      }

      return {
        identity: verifiedIdentity,
        status: "verified" as const,
      };
    });
  }

  async requestPasswordReset(emailValue: string): Promise<{ accepted: true }> {
    let normalizedEmail: string;

    try {
      normalizedEmail = normalizeEmailAddress(emailValue).normalizedEmail;
    } catch (error) {
      if (error instanceof AccountSecurityError && error.code === "invalid_email") {
        return { accepted: true };
      }

      throw error;
    }

    const identity = await this.requestStore.findEmailIdentityByNormalizedEmail(normalizedEmail);

    if (!identity?.verifiedAt) {
      return { accepted: true };
    }

    const issuedToken = await this.issueToken({
      emailIdentityId: identity.id,
      purpose: "password_reset",
      userId: identity.userId,
    });

    await this.sendActionEmail(
      identity,
      "password_reset",
      issuedToken.rawToken,
      issuedToken.expiresAt,
      "/reset-password",
    );

    return { accepted: true };
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<PostgresPasswordResetResult> {
    if (!isRawTokenCandidate(rawToken)) {
      return {
        status: "invalid_or_expired",
      };
    }

    const resetAt = this.now();
    const tokenHash = this.hashToken(rawToken, "password_reset");
    const activeToken = await this.requestStore.findActiveAccountToken(
      tokenHash,
      "password_reset",
      resetAt,
    );

    if (!activeToken?.emailIdentityId) {
      return {
        status: "invalid_or_expired",
      };
    }

    const [user, identity] = await Promise.all([
      this.requestStore.findUserById(activeToken.userId),
      this.requestStore.findEmailIdentityById(activeToken.emailIdentityId),
    ]);

    if (!user || !identity?.verifiedAt || identity.userId !== activeToken.userId) {
      return {
        status: "invalid_or_expired",
      };
    }

    await assertPasswordPolicy(
      newPassword,
      {
        email: identity.email,
        username: user.username,
      },
      this.passwordPolicy,
    );

    const passwordHash = hashPassword(newPassword);

    return this.requestStore.withTransaction(async (store) => {
      const consumedToken = await store.consumeActiveAccountToken(
        tokenHash,
        "password_reset",
        resetAt,
      );

      if (!consumedToken) {
        return {
          status: "invalid_or_expired" as const,
        };
      }

      const updated = await store.updatePasswordHash(activeToken.userId, passwordHash);

      if (!updated) {
        throw new Error("Password reset user disappeared during transaction.");
      }

      const sessionsRevoked = Number(
        await store.revokeAuthSessionsByUserId(activeToken.userId, resetAt),
      );
      await store.invalidateAccountTokens({
        invalidatedAt: resetAt,
        purpose: "password_reset",
        reason: "password_reset_completed",
        userId: activeToken.userId,
      });

      return {
        sessionsRevoked,
        status: "password_reset" as const,
        userId: activeToken.userId,
      };
    });
  }

  async requestAccountExport(userId: string): Promise<PostgresAccountExportRequestResult> {
    const user = await this.requestStore.findUserById(userId);

    if (!user) {
      throw new AccountSecurityError("user_not_found", "User not found.");
    }

    const identity = await this.requestStore.findEmailIdentityByUserId(userId);

    if (!identity?.verifiedAt) {
      throw new AccountSecurityError(
        "email_not_verified",
        "Verify your email before requesting an account export.",
      );
    }

    const issuedToken = await this.issueToken({
      emailIdentityId: identity.id,
      purpose: "account_export",
      userId,
    });
    const delivery = await this.sendActionEmail(
      identity,
      "account_export",
      issuedToken.rawToken,
      issuedToken.expiresAt,
      "/account/export",
    );

    return {
      delivery,
      expiresAt: issuedToken.expiresAt,
      status: "requested",
    };
  }

  async exportAccountData(rawToken: string) {
    if (!isRawTokenCandidate(rawToken)) {
      return {
        status: "invalid_or_expired" as const,
      };
    }

    const exportedAt = this.now();
    const tokenHash = this.hashToken(rawToken, "account_export");

    return this.requestStore.withTransaction(async (store) => {
      const token = await store.consumeActiveAccountToken(tokenHash, "account_export", exportedAt);

      if (!token) {
        return {
          status: "invalid_or_expired" as const,
        };
      }

      const data = await store.exportAccountData(token.userId, exportedAt);

      if (!data) {
        throw new Error("Account export user disappeared during transaction.");
      }

      return {
        data,
        status: "exported" as const,
      };
    });
  }

  async deleteAccount(input: { confirmationUsername: string; userId: string }) {
    const user = await this.requestStore.findUserById(input.userId);

    if (!user) {
      return {
        status: "not_found" as const,
      };
    }

    if (input.confirmationUsername.trim().toLowerCase() !== user.username.trim().toLowerCase()) {
      return {
        status: "confirmation_mismatch" as const,
      };
    }

    const deleted = await this.requestStore.deleteAccount(input.userId, user.username);

    return deleted
      ? {
          status: "deleted" as const,
        }
      : {
          status: "not_found" as const,
        };
  }

  private hashToken(rawToken: string, purpose: AccountTokenPurpose) {
    return createHash("sha256")
      .update("closetsearch-account-token-v1")
      .update("\0")
      .update(purpose)
      .update("\0")
      .update(this.tokenPepper)
      .update("\0")
      .update(rawToken)
      .digest("hex");
  }

  private async issueToken(input: {
    emailIdentityId?: string;
    purpose: AccountTokenPurpose;
    userId: string;
  }) {
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.tokenTtlMs[input.purpose]);
    const rawToken = this.generateRawToken();

    if (!isRawTokenCandidate(rawToken)) {
      throw new Error(
        `Generated ${input.purpose} token must contain between 1 and ${maximumRawTokenLength} characters.`,
      );
    }

    const record = await this.requestStore.issueAccountToken({
      createdAt,
      expiresAt,
      emailIdentityId: input.emailIdentityId,
      purpose: input.purpose,
      tokenHash: this.hashToken(rawToken, input.purpose),
      userId: input.userId,
    });

    return {
      expiresAt: record.expiresAt,
      rawToken,
    };
  }

  private async sendActionEmail(
    identity: EmailIdentityRecord,
    kind: AccountEmailKind,
    rawToken: string,
    expiresAt: string,
    pathname: string,
  ) {
    const actionUrl = new URL(pathname, this.actionBaseUrl);
    actionUrl.hash = new URLSearchParams({
      token: rawToken,
    }).toString();

    return this.emailSender.send({
      actionUrl: actionUrl.toString(),
      expiresAt,
      kind,
      to: identity.email,
    });
  }
}
