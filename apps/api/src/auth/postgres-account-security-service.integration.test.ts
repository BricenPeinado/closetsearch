import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import type { RequestAuthSession } from "../db/postgres/request-store-types.js";
import { PasswordPolicyError } from "./password-policy.js";
import { createInjectedAccountEmailSender, type AccountEmailMessage } from "./email-sender.js";
import { hashPassword, verifyPassword } from "./password-service.js";
import { PostgresAccountSecurityService } from "./postgres-account-security-service.js";

function sessionHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function getMessageToken(message: AccountEmailMessage) {
  const actionUrl = new URL(message.actionUrl);
  const token = new URLSearchParams(actionUrl.hash.slice(1)).get("token");

  if (!token) {
    throw new Error("Expected an account action token.");
  }

  return token;
}

describe("PostgresAccountSecurityService", () => {
  let dataPlane: PostgresDataPlane;
  let harness: Awaited<ReturnType<typeof createPostgresTestHarness>>;
  let messages: AccountEmailMessage[];
  let nowMs: number;
  let service: PostgresAccountSecurityService;
  let tokenSequence: number;

  beforeEach(async () => {
    harness = await createPostgresTestHarness();
    dataPlane = harness.dataPlane;
    messages = [];
    nowMs = Date.parse("2020-07-24T12:00:00.000Z");
    tokenSequence = 0;
    service = new PostgresAccountSecurityService(dataPlane, {
      actionBaseUrl: "https://closetsearch.example/account/",
      emailSender: createInjectedAccountEmailSender(async (message) => {
        messages.push(message);
        return {
          providerMessageId: `message-${messages.length}`,
          status: "accepted",
        };
      }),
      generateRawToken: () => `raw-postgres-account-token-${(tokenSequence += 1)}`,
      now: () => new Date(nowMs),
      tokenPepper: "postgres-account-token-test-pepper-32",
    });
  });

  afterEach(async () => {
    await harness.database.close();
  });

  async function createAccount(username = "recoveryfan") {
    const user = await dataPlane.requestStore.createUser({
      createdAt: new Date(nowMs),
      passwordHash: hashPassword("starting password phrase"),
      username,
    });
    await service.setEmailIdentity(user.id, `${username}@Example.com`);
    return user;
  }

  async function verifyAccount(userId: string) {
    await service.requestEmailVerification(userId);
    const verificationMessage = messages.at(-1);

    if (!verificationMessage) {
      throw new Error("Verification message was not captured.");
    }

    return service.verifyEmail(getMessageToken(verificationMessage));
  }

  it("fails closed for unsafe delivery configuration and production token hashing", () => {
    const emailSender = createInjectedAccountEmailSender(async () => ({
      status: "accepted",
    }));

    expect(
      () =>
        new PostgresAccountSecurityService(dataPlane, {
          emailSender,
          tokenPepper: "postgres-account-token-test-pepper-32",
        }),
    ).toThrow(/explicit account action base URL/u);
    expect(
      () =>
        new PostgresAccountSecurityService(dataPlane, {
          actionBaseUrl: "http://closetsearch.example",
          emailSender,
          tokenPepper: "postgres-account-token-test-pepper-32",
        }),
    ).toThrow(/must use HTTPS/u);
    expect(
      () =>
        new PostgresAccountSecurityService(dataPlane, {
          nodeEnv: "production",
          tokenPepper: "short",
        }),
    ).toThrow(/at least 32 characters/u);
  });

  it("normalizes identities, prevents cross-account reuse, and consumes verification once", async () => {
    const first = await createAccount();
    const second = await dataPlane.requestStore.createUser({
      createdAt: new Date(nowMs),
      passwordHash: hashPassword("another starting password"),
      username: "secondfan",
    });
    const identity = await dataPlane.requestStore.findEmailIdentityByUserId(first.id);

    expect(identity).toMatchObject({
      email: "recoveryfan@Example.com",
      normalizedEmail: "recoveryfan@example.com",
    });
    await expect(
      service.setEmailIdentity(second.id, "RECOVERYFAN@example.com"),
    ).rejects.toMatchObject({
      code: "email_in_use",
    });

    const request = await service.requestEmailVerification(first.id);
    const rawToken = getMessageToken(messages[0] as AccountEmailMessage);
    const persisted = await harness.database.query<{
      token_hash: string;
    }>(
      `SELECT token_hash
       FROM account_tokens
       WHERE user_id = $1`,
      [first.id],
    );

    expect(request).toMatchObject({
      delivery: {
        status: "accepted",
      },
      status: "requested",
    });
    expect(JSON.stringify(request)).not.toContain(rawToken);
    expect(persisted.rows[0]?.token_hash).toHaveLength(64);
    expect(persisted.rows[0]?.token_hash).not.toBe(rawToken);
    await expect(service.verifyEmail(rawToken)).resolves.toMatchObject({
      identity: {
        userId: first.id,
        verifiedAt: "2020-07-24T12:00:00.000Z",
      },
      status: "verified",
    });
    await expect(service.verifyEmail(rawToken)).resolves.toEqual({
      status: "invalid_or_expired",
    });
  });

  it("supersedes verification tokens and invalidates them when the email changes", async () => {
    const user = await createAccount();

    await service.requestEmailVerification(user.id);
    const firstToken = getMessageToken(messages[0] as AccountEmailMessage);
    nowMs += 1_000;
    await service.requestEmailVerification(user.id);
    const secondToken = getMessageToken(messages[1] as AccountEmailMessage);

    await expect(service.verifyEmail(firstToken)).resolves.toEqual({
      status: "invalid_or_expired",
    });

    nowMs += 1_000;
    await service.setEmailIdentity(user.id, "new-email@example.com");

    await expect(service.verifyEmail(secondToken)).resolves.toEqual({
      status: "invalid_or_expired",
    });
  });

  it("keeps reset requests generic and atomically resets, revokes, invalidates, and rejects reuse", async () => {
    const user = await createAccount();

    await expect(service.requestPasswordReset("unknown@example.com")).resolves.toEqual({
      accepted: true,
    });
    await expect(service.requestPasswordReset("not-an-email")).resolves.toEqual({ accepted: true });
    await expect(service.requestPasswordReset("recoveryfan@example.com")).resolves.toEqual({
      accepted: true,
    });
    expect(messages).toHaveLength(0);

    await verifyAccount(user.id);
    messages = [];
    const sessions: RequestAuthSession[] = [];

    for (const label of ["session-one", "session-two"]) {
      sessions.push(
        await dataPlane.requestStore.createAuthSession({
          createdAt: new Date(nowMs),
          expiresAt: new Date(nowMs + 86_400_000),
          sessionTokenHash: sessionHash(label),
          userId: user.id,
        }),
      );
    }

    await expect(service.requestPasswordReset("RECOVERYFAN@example.com")).resolves.toEqual({
      accepted: true,
    });
    const rawToken = getMessageToken(messages[0] as AccountEmailMessage);

    await expect(service.resetPassword(rawToken, "short")).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
    await expect(service.resetPassword(rawToken, "violet sparrow orbit lantern")).resolves.toEqual({
      sessionsRevoked: 2,
      status: "password_reset",
      userId: user.id,
    });

    const credentials = await dataPlane.requestStore.findUserCredentialsByNormalizedUsername(
      user.username,
    );
    expect(
      verifyPassword(credentials?.passwordHash ?? "", "violet sparrow orbit lantern").isValid,
    ).toBe(true);
    expect(
      verifyPassword(credentials?.passwordHash ?? "", "starting password phrase").isValid,
    ).toBe(false);

    for (const session of sessions) {
      await expect(
        dataPlane.requestStore.findAuthSessionByTokenHash(
          sessionHash(session === sessions[0] ? "session-one" : "session-two"),
        ),
      ).resolves.toMatchObject({
        revokedAt: "2020-07-24T12:00:00.000Z",
      });
    }

    await expect(service.resetPassword(rawToken, "another violet orbit lantern")).resolves.toEqual({
      status: "invalid_or_expired",
    });
  });

  it("rejects exact-expiry tokens and keeps disabled delivery from exposing raw tokens", async () => {
    const user = await createAccount();

    await verifyAccount(user.id);
    messages = [];
    await service.requestPasswordReset("recoveryfan@example.com");
    const rawToken = getMessageToken(messages[0] as AccountEmailMessage);
    nowMs += 30 * 60 * 1_000;

    await expect(service.resetPassword(rawToken, "violet sparrow orbit lantern")).resolves.toEqual({
      status: "invalid_or_expired",
    });

    const disabledService = new PostgresAccountSecurityService(dataPlane, {
      generateRawToken: () => "raw-disabled-delivery-token",
      now: () => new Date(nowMs),
      tokenPepper: "postgres-account-token-test-pepper-32",
    });
    await disabledService.setEmailIdentity(user.id, "disabled-delivery@example.com");
    const request = await disabledService.requestEmailVerification(user.id);

    expect(request).toMatchObject({
      delivery: {
        reason: "not_configured",
        status: "disabled",
      },
      status: "requested",
    });
    expect(JSON.stringify(request)).not.toContain("raw-disabled-delivery-token");
  });

  it("exports once without secrets and deletes only with authenticated username confirmation", async () => {
    const user = await createAccount();

    await verifyAccount(user.id);
    messages = [];
    await dataPlane.requestStore.createAuthSession({
      createdAt: new Date(nowMs),
      expiresAt: new Date(nowMs + 86_400_000),
      sessionTokenHash: sessionHash("delete-session"),
      userId: user.id,
    });

    const request = await service.requestAccountExport(user.id);
    const rawToken = getMessageToken(messages[0] as AccountEmailMessage);
    const result = await service.exportAccountData(rawToken);
    const serialized = JSON.stringify(result);

    expect(request).toMatchObject({
      delivery: {
        status: "accepted",
      },
      status: "requested",
    });
    expect(result).toMatchObject({
      data: {
        account: {
          id: user.id,
          username: "recoveryfan",
        },
        emailIdentities: [
          {
            email: "recoveryfan@Example.com",
          },
        ],
        schemaVersion: 2,
      },
      status: "exported",
    });
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("password_hash");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("token_hash");
    expect(serialized).not.toContain(rawToken);
    await expect(service.exportAccountData(rawToken)).resolves.toEqual({
      status: "invalid_or_expired",
    });

    await expect(
      service.deleteAccount({
        confirmationUsername: "wrong-user",
        userId: user.id,
      }),
    ).resolves.toEqual({
      status: "confirmation_mismatch",
    });
    await expect(
      service.deleteAccount({
        confirmationUsername: " RecoveryFan ",
        userId: user.id,
      }),
    ).resolves.toEqual({
      status: "deleted",
    });
    await expect(dataPlane.requestStore.findUserById(user.id)).resolves.toBeUndefined();
    await expect(
      dataPlane.requestStore.findAuthSessionByTokenHash(sessionHash("delete-session")),
    ).resolves.toBeUndefined();
  });
});
