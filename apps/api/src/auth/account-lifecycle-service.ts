import { deleteUserByIdAndNormalizedUsername, findUserById } from "../db/repositories/users.js";
import { findUserEmailIdentityByUserId } from "../db/repositories/user-email-identities.js";
import { getAccountDataExport } from "../db/repositories/account-data.js";
import { runInImmediateTransaction } from "../db/transaction.js";
import { AccountSecurityError } from "./account-security-error.js";
import { AccountTokenService } from "./account-token-service.js";
import {
  disabledAccountEmailSender,
  type AccountEmailDelivery,
  type AccountEmailSender,
} from "./email-sender.js";

export interface AccountLifecycleServiceOptions {
  actionBaseUrl?: string;
  emailSender?: AccountEmailSender;
  now?: () => Date;
  tokenService?: AccountTokenService;
}

export interface AccountExportRequestResult {
  delivery: AccountEmailDelivery;
  expiresAt: string;
  status: "requested";
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function validateActionBaseUrl(value: string) {
  const url = new URL(value);
  const isLocalHttp =
    url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new TypeError("Account action base URL must use HTTPS outside local development.");
  }

  return url;
}

export class AccountLifecycleService {
  private readonly actionBaseUrl: URL;
  private readonly emailSender: AccountEmailSender;
  private readonly now: () => Date;
  private readonly tokenService: AccountTokenService;

  constructor(options: AccountLifecycleServiceOptions = {}) {
    if (options.emailSender && !options.actionBaseUrl) {
      throw new TypeError(
        "A configured email sender requires an explicit account action base URL.",
      );
    }

    this.actionBaseUrl = validateActionBaseUrl(options.actionBaseUrl ?? "http://localhost:5173");
    this.emailSender = options.emailSender ?? disabledAccountEmailSender;
    this.now = options.now ?? (() => new Date());
    this.tokenService =
      options.tokenService ??
      new AccountTokenService({
        now: this.now,
      });
  }

  async requestAccountExport(userId: string): Promise<AccountExportRequestResult> {
    const user = findUserById(userId);

    if (!user) {
      throw new AccountSecurityError("user_not_found", "User not found.");
    }

    const identity = findUserEmailIdentityByUserId(userId);

    if (!identity?.verifiedAt) {
      throw new AccountSecurityError(
        "email_not_verified",
        "Verify your email before requesting an account export.",
      );
    }

    const issuedToken = this.tokenService.issue({
      emailIdentityId: identity.id,
      purpose: "account_export",
      userId,
    });
    const actionUrl = new URL("/account/export", this.actionBaseUrl);
    actionUrl.hash = new URLSearchParams({
      token: issuedToken.rawToken,
    }).toString();
    const delivery = await this.emailSender.send({
      actionUrl: actionUrl.toString(),
      expiresAt: issuedToken.expiresAt,
      kind: "account_export",
      to: identity.email,
    });

    return {
      delivery,
      expiresAt: issuedToken.expiresAt,
      status: "requested",
    };
  }

  exportAccountData(rawToken: string) {
    const exportedAt = this.now().toISOString();

    return runInImmediateTransaction(() => {
      const token = this.tokenService.consumeWithinTransaction(
        rawToken,
        "account_export",
        exportedAt,
      );

      if (!token) {
        return {
          status: "invalid_or_expired" as const,
        };
      }

      const accountData = getAccountDataExport(token.userId, exportedAt);

      if (!accountData) {
        throw new Error("Account export user disappeared during transaction.");
      }

      return {
        data: accountData,
        status: "exported" as const,
      };
    });
  }

  deleteAccount(input: { confirmationUsername: string; userId: string }) {
    const user = findUserById(input.userId);

    if (!user) {
      return {
        status: "not_found" as const,
      };
    }

    if (normalizeUsername(input.confirmationUsername) !== normalizeUsername(user.username)) {
      return {
        status: "confirmation_mismatch" as const,
      };
    }

    return runInImmediateTransaction(() => {
      const deleted = deleteUserByIdAndNormalizedUsername(
        input.userId,
        normalizeUsername(user.username),
      );

      if (!deleted) {
        return {
          status: "not_found" as const,
        };
      }

      return {
        status: "deleted" as const,
      };
    });
  }
}
