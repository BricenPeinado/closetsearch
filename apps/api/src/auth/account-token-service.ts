import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  consumeActiveAccountToken,
  findAccountTokenByHash,
  insertAccountToken,
  invalidateActiveAccountTokens,
  type AccountTokenPurpose,
  type AccountTokenRecord,
} from "../db/repositories/account-tokens.js";
import { runInImmediateTransaction } from "../db/transaction.js";
import { getAuthConfig } from "./config.js";

const defaultTtlMs: Record<AccountTokenPurpose, number> = {
  account_export: 15 * 60 * 1_000,
  email_verification: 24 * 60 * 60 * 1_000,
  password_reset: 30 * 60 * 1_000,
};

export interface IssuedAccountToken {
  expiresAt: string;
  rawToken: string;
  record: AccountTokenRecord;
}

export interface AccountTokenServiceOptions {
  generateRawToken?: () => string;
  now?: () => Date;
  tokenPepper?: string;
  ttlMs?: Partial<Record<AccountTokenPurpose, number>>;
}

export class AccountTokenService {
  private readonly generateRawToken: () => string;
  private readonly now: () => Date;
  private readonly tokenPepper: string;
  private readonly ttlMs: Record<AccountTokenPurpose, number>;

  constructor(options: AccountTokenServiceOptions = {}) {
    this.generateRawToken =
      options.generateRawToken ??
      (() => randomBytes(32).toString("base64url"));
    this.now = options.now ?? (() => new Date());
    this.tokenPepper = options.tokenPepper ?? getAuthConfig().tokenPepper;
    this.ttlMs = {
      ...defaultTtlMs,
      ...options.ttlMs,
    };
  }

  issue(input: {
    emailIdentityId?: string;
    purpose: AccountTokenPurpose;
    userId: string;
  }): IssuedAccountToken {
    const now = this.now();
    const createdAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + this.ttlMs[input.purpose],
    ).toISOString();
    const rawToken = this.generateRawToken();
    const record: AccountTokenRecord = {
      createdAt,
      emailIdentityId: input.emailIdentityId,
      expiresAt,
      id: randomUUID(),
      purpose: input.purpose,
      tokenHash: this.hash(rawToken),
      userId: input.userId,
    };

    runInImmediateTransaction(() => {
      invalidateActiveAccountTokens({
        invalidatedAt: createdAt,
        purpose: input.purpose,
        reason: "superseded",
        userId: input.userId,
      });
      insertAccountToken(record);
    });

    return {
      expiresAt,
      rawToken,
      record,
    };
  }

  consumeWithinTransaction(
    rawToken: string,
    purpose: AccountTokenPurpose,
    consumedAt = this.now().toISOString(),
  ) {
    return consumeActiveAccountToken({
      consumedAt,
      purpose,
      tokenHash: this.hash(rawToken),
    });
  }

  resolveActive(
    rawToken: string,
    purpose: AccountTokenPurpose,
    at = this.now().toISOString(),
  ) {
    const token = findAccountTokenByHash(this.hash(rawToken));

    if (
      !token ||
      token.purpose !== purpose ||
      token.consumedAt ||
      token.invalidatedAt ||
      token.expiresAt <= at
    ) {
      return undefined;
    }

    return token;
  }

  invalidateAllForUser(
    userId: string,
    reason: string,
    invalidatedAt = this.now().toISOString(),
  ) {
    return invalidateActiveAccountTokens({
      invalidatedAt,
      reason,
      userId,
    });
  }

  private hash(rawToken: string) {
    return createHash("sha256")
      .update(this.tokenPepper)
      .update(":")
      .update(rawToken)
      .digest("hex");
  }
}
