import { randomUUID } from "node:crypto";
import {
  invalidateActiveAccountTokens,
} from "../db/repositories/account-tokens.js";
import { revokeAuthSessionsByUserId } from "../db/repositories/auth-sessions.js";
import {
  findUserEmailIdentityById,
  findUserEmailIdentityByNormalizedEmail,
  findUserEmailIdentityByUserId,
  markUserEmailIdentityVerified,
  upsertUserEmailIdentity,
  type UserEmailIdentityRecord,
} from "../db/repositories/user-email-identities.js";
import {
  findUserById,
  updateUserPasswordHash,
} from "../db/repositories/users.js";
import { runInImmediateTransaction } from "../db/transaction.js";
import { hashPassword } from "./password-service.js";
import {
  assertPasswordPolicy,
  type PasswordPolicyOptions,
} from "./password-policy.js";
import { AccountSecurityError } from "./account-security-error.js";
import { AccountTokenService } from "./account-token-service.js";
import { normalizeEmailAddress } from "./email-address.js";
import {
  disabledAccountEmailSender,
  type AccountEmailDelivery,
  type AccountEmailKind,
  type AccountEmailSender,
} from "./email-sender.js";

export interface AccountRecoveryServiceOptions {
  actionBaseUrl?: string;
  emailSender?: AccountEmailSender;
  now?: () => Date;
  passwordPolicy?: PasswordPolicyOptions;
  tokenService?: AccountTokenService;
}

export type VerificationRequestResult =
  | {
      status: "already_verified";
    }
  | {
      delivery: AccountEmailDelivery;
      expiresAt: string;
      status: "requested";
    };

export interface PasswordResetRequestResult {
  accepted: true;
}

export type PasswordResetResult =
  | {
      sessionsRevoked: number;
      status: "password_reset";
      userId: string;
    }
  | {
      status: "invalid_or_expired";
    };

function validateActionBaseUrl(value: string) {
  const url = new URL(value);
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new TypeError(
      "Account action base URL must use HTTPS outside local development.",
    );
  }

  return url;
}

export class AccountRecoveryService {
  private readonly actionBaseUrl: URL;
  private readonly emailSender: AccountEmailSender;
  private readonly now: () => Date;
  private readonly passwordPolicy: PasswordPolicyOptions;
  private readonly tokenService: AccountTokenService;

  constructor(options: AccountRecoveryServiceOptions = {}) {
    if (options.emailSender && !options.actionBaseUrl) {
      throw new TypeError(
        "A configured email sender requires an explicit account action base URL.",
      );
    }

    this.actionBaseUrl = validateActionBaseUrl(
      options.actionBaseUrl ?? "http://localhost:5173",
    );
    this.emailSender = options.emailSender ?? disabledAccountEmailSender;
    this.now = options.now ?? (() => new Date());
    this.passwordPolicy = options.passwordPolicy ?? {};
    this.tokenService =
      options.tokenService ??
      new AccountTokenService({
        now: this.now,
      });
  }

  setEmailIdentity(userId: string, emailValue: string) {
    const user = findUserById(userId);

    if (!user) {
      throw new AccountSecurityError("user_not_found", "User not found.");
    }

    const { email, normalizedEmail } = normalizeEmailAddress(emailValue);
    const now = this.now().toISOString();

    return runInImmediateTransaction(() => {
      const claimedIdentity =
        findUserEmailIdentityByNormalizedEmail(normalizedEmail);

      if (claimedIdentity && claimedIdentity.userId !== userId) {
        throw new AccountSecurityError(
          "email_in_use",
          "That email address is already in use.",
        );
      }

      const existingIdentity = findUserEmailIdentityByUserId(userId);

      if (
        existingIdentity &&
        existingIdentity.normalizedEmail !== normalizedEmail
      ) {
        this.tokenService.invalidateAllForUser(
          userId,
          "email_changed",
          now,
        );
      }

      return upsertUserEmailIdentity({
        createdAt: existingIdentity?.createdAt ?? now,
        email,
        id: existingIdentity?.id ?? randomUUID(),
        normalizedEmail,
        updatedAt: now,
        userId,
      });
    });
  }

  async requestEmailVerification(
    userId: string,
  ): Promise<VerificationRequestResult> {
    const identity = findUserEmailIdentityByUserId(userId);

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

    const issuedToken = this.tokenService.issue({
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

  verifyEmail(rawToken: string) {
    const verifiedAt = this.now().toISOString();

    return runInImmediateTransaction(() => {
      const token = this.tokenService.consumeWithinTransaction(
        rawToken,
        "email_verification",
        verifiedAt,
      );

      if (!token?.emailIdentityId) {
        return {
          status: "invalid_or_expired" as const,
        };
      }

      const identity = findUserEmailIdentityById(token.emailIdentityId);

      if (!identity || identity.userId !== token.userId) {
        throw new Error("Verification token identity invariant failed.");
      }

      const verifiedIdentity = markUserEmailIdentityVerified(
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

  async requestPasswordReset(
    emailValue: string,
  ): Promise<PasswordResetRequestResult> {
    let normalizedEmail: string;

    try {
      normalizedEmail = normalizeEmailAddress(emailValue).normalizedEmail;
    } catch (error) {
      if (
        error instanceof AccountSecurityError &&
        error.code === "invalid_email"
      ) {
        return { accepted: true };
      }

      throw error;
    }

    const identity =
      findUserEmailIdentityByNormalizedEmail(normalizedEmail);

    if (!identity?.verifiedAt) {
      return { accepted: true };
    }

    const issuedToken = this.tokenService.issue({
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

  async resetPassword(
    rawToken: string,
    newPassword: string,
  ): Promise<PasswordResetResult> {
    const activeToken = this.tokenService.resolveActive(
      rawToken,
      "password_reset",
    );

    if (!activeToken) {
      return {
        status: "invalid_or_expired",
      };
    }

    const user = findUserById(activeToken.userId);
    const identity = activeToken.emailIdentityId
      ? findUserEmailIdentityById(activeToken.emailIdentityId)
      : undefined;

    if (!user || !identity || identity.userId !== user.id) {
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

    const resetAt = this.now().toISOString();
    const passwordHash = hashPassword(newPassword);

    return runInImmediateTransaction(() => {
      const consumedToken = this.tokenService.consumeWithinTransaction(
        rawToken,
        "password_reset",
        resetAt,
      );

      if (!consumedToken) {
        return {
          status: "invalid_or_expired" as const,
        };
      }

      const updatedUser = updateUserPasswordHash(user.id, passwordHash);

      if (!updatedUser) {
        throw new Error("Password reset user disappeared during transaction.");
      }

      const sessionsRevoked = Number(
        revokeAuthSessionsByUserId(user.id, resetAt),
      );

      invalidateActiveAccountTokens({
        invalidatedAt: resetAt,
        purpose: "password_reset",
        reason: "password_reset_completed",
        userId: user.id,
      });

      return {
        sessionsRevoked,
        status: "password_reset" as const,
        userId: user.id,
      };
    });
  }

  private async sendActionEmail(
    identity: UserEmailIdentityRecord,
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
