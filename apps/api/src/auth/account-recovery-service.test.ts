import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDatabase } from "../db/database.js";
import { findAuthSessionByTokenHash, insertAuthSession } from "../db/repositories/auth-sessions.js";
import { listAccountTokensByUserId } from "../db/repositories/account-tokens.js";
import { findUserEmailIdentityByUserId } from "../db/repositories/user-email-identities.js";
import { cleanupIsolatedDatabase, useIsolatedDatabase } from "../db/test-helpers.js";
import { createUser, getUserById, loginUser, resetUserStore } from "../user-service.js";
import { AccountLifecycleService } from "./account-lifecycle-service.js";
import { registerUserWithPasswordPolicy } from "./account-registration-service.js";
import { AccountRecoveryService } from "./account-recovery-service.js";
import { AccountTokenService } from "./account-token-service.js";
import { createInjectedAccountEmailSender, type AccountEmailMessage } from "./email-sender.js";
import { PasswordPolicyError } from "./password-policy.js";

function getMessageToken(message: AccountEmailMessage) {
  const actionUrl = new URL(message.actionUrl);
  const token = new URLSearchParams(actionUrl.hash.slice(1)).get("token");

  if (!token) {
    throw new Error("Expected an account action token.");
  }

  return token;
}

describe("account recovery and lifecycle services", () => {
  let databasePath = "";
  let nowMs = Date.parse("2026-07-24T12:00:00.000Z");
  let tokenSequence = 0;
  let messages: AccountEmailMessage[] = [];
  let tokenService: AccountTokenService;
  let recoveryService: AccountRecoveryService;
  let lifecycleService: AccountLifecycleService;

  beforeEach(() => {
    databasePath = useIsolatedDatabase("account-recovery");
    resetUserStore();
    nowMs = Date.parse("2026-07-24T12:00:00.000Z");
    tokenSequence = 0;
    messages = [];
    const now = () => new Date(nowMs);
    const emailSender = createInjectedAccountEmailSender(async (message) => {
      messages.push(message);
      return {
        providerMessageId: `message-${messages.length}`,
        status: "accepted",
      };
    });
    tokenService = new AccountTokenService({
      generateRawToken: () => `raw-account-token-${(tokenSequence += 1)}`,
      now,
      tokenPepper: "account-token-test-pepper",
    });
    recoveryService = new AccountRecoveryService({
      actionBaseUrl: "https://closetsearch.example/account/",
      emailSender,
      now,
      tokenService,
    });
    lifecycleService = new AccountLifecycleService({
      actionBaseUrl: "https://closetsearch.example/account/",
      emailSender,
      now,
      tokenService,
    });
  });

  afterEach(() => {
    cleanupIsolatedDatabase(databasePath);
  });

  function createAccount() {
    const signup = createUser("recoveryfan", "starting-password");
    recoveryService.setEmailIdentity(signup.userId, "RecoveryFan@Example.com");
    return signup;
  }

  function verifyAccountEmail(userId: string) {
    return recoveryService.requestEmailVerification(userId).then(() => {
      const verificationMessage = messages.at(-1);

      if (!verificationMessage) {
        throw new Error("Verification message was not captured.");
      }

      return recoveryService.verifyEmail(getMessageToken(verificationMessage));
    });
  }

  it("offers a policy-enforced registration boundary for route integration", async () => {
    await expect(registerUserWithPasswordPolicy("securefan", "short")).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
    await expect(
      registerUserWithPasswordPolicy("securefan", "violet sparrow orbit lantern"),
    ).resolves.toMatchObject({
      user: {
        username: "securefan",
      },
    });
  });

  it("fails closed for configured delivery without an explicit HTTPS action origin", () => {
    const emailSender = createInjectedAccountEmailSender(async () => ({
      status: "accepted",
    }));

    expect(
      () =>
        new AccountRecoveryService({
          emailSender,
        }),
    ).toThrow(/explicit account action base URL/u);
    expect(
      () =>
        new AccountRecoveryService({
          actionBaseUrl: "http://closetsearch.example",
          emailSender,
        }),
    ).toThrow(/must use HTTPS/u);
  });

  it("normalizes an email identity and prevents cross-account reuse", () => {
    const first = createAccount();
    const second = createUser("secondfan", "starting-password");

    expect(findUserEmailIdentityByUserId(first.userId)).toMatchObject({
      email: "RecoveryFan@Example.com",
      normalizedEmail: "recoveryfan@example.com",
      userId: first.userId,
    });
    expect(() =>
      recoveryService.setEmailIdentity(second.userId, "recoveryfan@example.com"),
    ).toThrowError(
      expect.objectContaining({
        code: "email_in_use",
      }),
    );
  });

  it("stores only a token hash and consumes verification exactly once", async () => {
    const signup = createAccount();
    const request = await recoveryService.requestEmailVerification(signup.userId);
    const rawToken = getMessageToken(messages[0] as AccountEmailMessage);
    const storedToken = listAccountTokensByUserId(signup.userId)[0];

    expect(request).toMatchObject({
      delivery: {
        status: "accepted",
      },
      status: "requested",
    });
    expect(JSON.stringify(request)).not.toContain(rawToken);
    expect(storedToken?.tokenHash).toHaveLength(64);
    expect(storedToken?.tokenHash).not.toBe(rawToken);
    expect(recoveryService.verifyEmail(rawToken)).toMatchObject({
      identity: {
        userId: signup.userId,
        verifiedAt: "2026-07-24T12:00:00.000Z",
      },
      status: "verified",
    });
    expect(recoveryService.verifyEmail(rawToken)).toEqual({
      status: "invalid_or_expired",
    });
  });

  it("supersedes earlier verification tokens and invalidates tokens on email change", async () => {
    const signup = createAccount();

    await recoveryService.requestEmailVerification(signup.userId);
    const firstToken = getMessageToken(messages[0] as AccountEmailMessage);
    await recoveryService.requestEmailVerification(signup.userId);
    const secondToken = getMessageToken(messages[1] as AccountEmailMessage);

    expect(recoveryService.verifyEmail(firstToken)).toEqual({
      status: "invalid_or_expired",
    });

    recoveryService.setEmailIdentity(signup.userId, "new-email@example.com");

    expect(recoveryService.verifyEmail(secondToken)).toEqual({
      status: "invalid_or_expired",
    });
  });

  it("does not reveal whether a password-reset email exists or is verified", async () => {
    const signup = createAccount();

    await expect(recoveryService.requestPasswordReset("unknown@example.com")).resolves.toEqual({
      accepted: true,
    });
    await expect(recoveryService.requestPasswordReset("not-an-email")).resolves.toEqual({
      accepted: true,
    });
    await expect(recoveryService.requestPasswordReset("recoveryfan@example.com")).resolves.toEqual({
      accepted: true,
    });

    expect(messages).toHaveLength(0);

    await verifyAccountEmail(signup.userId);
    messages = [];
    await expect(recoveryService.requestPasswordReset("RECOVERYFAN@example.com")).resolves.toEqual({
      accepted: true,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: "password_reset",
      to: "RecoveryFan@Example.com",
    });
  });

  it("atomically resets a password, revokes every session, and rejects reuse", async () => {
    const signup = createAccount();
    await verifyAccountEmail(signup.userId);
    messages = [];

    for (const sessionTokenHash of ["session-hash-one", "session-hash-two"]) {
      insertAuthSession({
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 86_400_000).toISOString(),
        id: randomUUID(),
        lastSeenAt: new Date(nowMs).toISOString(),
        sessionTokenHash,
        userId: signup.userId,
      });
    }

    await recoveryService.requestPasswordReset("recoveryfan@example.com");
    const rawToken = getMessageToken(messages[0] as AccountEmailMessage);

    await expect(recoveryService.resetPassword(rawToken, "short")).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
    await expect(
      recoveryService.resetPassword(rawToken, "violet sparrow orbit lantern"),
    ).resolves.toEqual({
      sessionsRevoked: 2,
      status: "password_reset",
      userId: signup.userId,
    });

    expect(findAuthSessionByTokenHash("session-hash-one")?.revokedAt).toBe(
      "2026-07-24T12:00:00.000Z",
    );
    expect(findAuthSessionByTokenHash("session-hash-two")?.revokedAt).toBe(
      "2026-07-24T12:00:00.000Z",
    );
    expect(() => loginUser("recoveryfan", "starting-password")).toThrow();
    expect(loginUser("recoveryfan", "violet sparrow orbit lantern").userId).toBe(signup.userId);
    await expect(
      recoveryService.resetPassword(rawToken, "another violet orbit lantern"),
    ).resolves.toEqual({
      status: "invalid_or_expired",
    });
  });

  it("rejects an expired password-reset token", async () => {
    const signup = createAccount();
    await verifyAccountEmail(signup.userId);
    messages = [];
    await recoveryService.requestPasswordReset("recoveryfan@example.com");
    const rawToken = getMessageToken(messages[0] as AccountEmailMessage);

    nowMs += 30 * 60 * 1_000;

    await expect(
      recoveryService.resetPassword(rawToken, "violet sparrow orbit lantern"),
    ).resolves.toEqual({
      status: "invalid_or_expired",
    });
  });

  it("keeps delivery disabled by default without exposing a development token", async () => {
    const signup = createUser("disabledmail", "starting-password");
    const disabledService = new AccountRecoveryService({
      now: () => new Date(nowMs),
      tokenService,
    });
    disabledService.setEmailIdentity(signup.userId, "disabled@example.com");

    const result = await disabledService.requestEmailVerification(signup.userId);

    expect(result).toMatchObject({
      delivery: {
        reason: "not_configured",
        status: "disabled",
      },
      status: "requested",
    });
    expect(JSON.stringify(result)).not.toContain("raw-account-token");
  });

  it("exports user-owned data once without credential secrets", async () => {
    const signup = createAccount();
    await verifyAccountEmail(signup.userId);
    getDatabase()
      .prepare(
        `INSERT INTO saved_searches (
          id,
          user_id,
          label,
          description,
          params,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        signup.userId,
        "Archive coats",
        "Saved search",
        "q=archive+coats",
        new Date(nowMs).toISOString(),
        new Date(nowMs).toISOString(),
      );
    messages = [];

    await lifecycleService.requestAccountExport(signup.userId);
    const rawToken = getMessageToken(messages[0] as AccountEmailMessage);
    const result = lifecycleService.exportAccountData(rawToken);
    const serializedResult = JSON.stringify(result);

    expect(result).toMatchObject({
      data: {
        account: {
          id: signup.userId,
          username: "recoveryfan",
        },
        emailIdentities: [
          {
            email: "RecoveryFan@Example.com",
          },
        ],
        savedSearches: [
          {
            label: "Archive coats",
          },
        ],
        schemaVersion: 1,
      },
      status: "exported",
    });
    expect(serializedResult).not.toContain("passwordHash");
    expect(serializedResult).not.toContain("password_hash");
    expect(serializedResult).not.toContain("tokenHash");
    expect(serializedResult).not.toContain("token_hash");
    expect(serializedResult).not.toContain(rawToken);
    expect(lifecycleService.exportAccountData(rawToken)).toEqual({
      status: "invalid_or_expired",
    });
  });

  it("requires explicit username confirmation and cascades account deletion", async () => {
    const signup = createAccount();
    await verifyAccountEmail(signup.userId);
    insertAuthSession({
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 86_400_000).toISOString(),
      id: randomUUID(),
      lastSeenAt: new Date(nowMs).toISOString(),
      sessionTokenHash: "deletion-session-hash",
      userId: signup.userId,
    });

    expect(
      lifecycleService.deleteAccount({
        confirmationUsername: "wrong-user",
        userId: signup.userId,
      }),
    ).toEqual({
      status: "confirmation_mismatch",
    });
    expect(getUserById(signup.userId)).toBeDefined();

    expect(
      lifecycleService.deleteAccount({
        confirmationUsername: " RecoveryFan ",
        userId: signup.userId,
      }),
    ).toEqual({
      status: "deleted",
    });
    expect(getUserById(signup.userId)).toBeUndefined();
    expect(findAuthSessionByTokenHash("deletion-session-hash")).toBeUndefined();
    expect(findUserEmailIdentityByUserId(signup.userId)).toBeUndefined();
    expect(listAccountTokensByUserId(signup.userId)).toEqual([]);
  });
});
