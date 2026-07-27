import type { IncomingMessage } from "node:http";
import { ApiError } from "../api-error.js";
import { requireAuth } from "../auth/auth-context.js";
import { PostgresAccountSecurityService } from "../auth/postgres-account-security-service.js";
import { createAccountEmailSenderFromEnvironment } from "../auth/email-sender.js";
import { clearSessionCookie } from "../auth/session-service.js";
import { parseJsonRequestBody } from "../http/request-body.js";
import { FixedWindowRateLimiter, getRequestIpHint } from "../http/rate-limit.js";
import type { RouteResult } from "./route-result.js";
import {
  getRequestDataPlane,
  isPostgresRequestPath,
  toPostgresApiError,
  trimmedString,
} from "./postgres-route-support.js";

const accountActionRateLimiter = new FixedWindowRateLimiter({
  limit: 6,
  windowMs: 60_000,
});

async function payload(request: IncomingMessage) {
  const raw = await parseJsonRequestBody(request);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "invalid_request", "A JSON object is required.");
  }

  const value = raw as Record<string, unknown>;

  if ("userId" in value || "user_id" in value) {
    throw new ApiError(
      400,
      "spoofed_user_id",
      "User identity is derived from the authenticated session.",
    );
  }

  return value;
}

function json(body: unknown, statusCode = 200, headers?: Record<string, string>): RouteResult {
  return {
    body,
    headers,
    kind: "json",
    statusCode,
  };
}

export async function handlePostgresAccountRoute(
  request: IncomingMessage,
  requestUrl: URL,
): Promise<RouteResult | undefined> {
  if (!isPostgresRequestPath()) {
    return undefined;
  }

  const method = request.method ?? "GET";
  const path = requestUrl.pathname;
  const supported =
    (method === "PUT" && path === "/me/email") ||
    (method === "POST" && path === "/me/email/verification") ||
    (method === "POST" && path === "/auth/verify-email") ||
    (method === "POST" && path === "/auth/password-reset/request") ||
    (method === "POST" && path === "/auth/password-reset/complete") ||
    (method === "POST" && path === "/me/account-export") ||
    (method === "POST" && path === "/account/export") ||
    (method === "DELETE" && path === "/me");

  if (!supported) {
    return undefined;
  }

  try {
    accountActionRateLimiter.consume(`account-action:${path}:${getRequestIpHint(request)}`);
    const dataPlane = await getRequestDataPlane();
    const service = new PostgresAccountSecurityService(dataPlane, {
      actionBaseUrl: process.env.ACCOUNT_ACTION_BASE_URL?.trim() || undefined,
      emailSender: createAccountEmailSenderFromEnvironment(),
    });
    const body = await payload(request);

    if (method === "PUT" && path === "/me/email") {
      const user = requireAuth(request);
      const email = trimmedString(body.email);

      if (!email) {
        throw new ApiError(400, "invalid_request", "email is required.");
      }

      return json({
        identity: await service.setEmailIdentity(user.id, email),
      });
    }

    if (method === "POST" && path === "/me/email/verification") {
      const user = requireAuth(request);
      return json(await service.requestEmailVerification(user.id), 202);
    }

    if (method === "POST" && path === "/auth/verify-email") {
      const result = await service.verifyEmail(trimmedString(body.token));

      return result.status === "verified"
        ? json(result)
        : json(
            {
              error: "invalid_or_expired_token",
              message: "The verification link is invalid or has expired.",
            },
            400,
          );
    }

    if (method === "POST" && path === "/auth/password-reset/request") {
      await service.requestPasswordReset(trimmedString(body.email));
      return json(
        {
          accepted: true,
          message: "If a verified account matches that email, a reset link will be sent.",
        },
        202,
      );
    }

    if (method === "POST" && path === "/auth/password-reset/complete") {
      const token = trimmedString(body.token);
      const password = typeof body.password === "string" ? body.password : "";
      const result = await service.resetPassword(token, password);

      return result.status === "password_reset"
        ? json(result, 200, {
            "cache-control": "no-store",
            "set-cookie": clearSessionCookie(),
          })
        : json(
            {
              error: "invalid_or_expired_token",
              message: "The reset link is invalid or has expired.",
            },
            400,
            { "cache-control": "no-store" },
          );
    }

    if (method === "POST" && path === "/me/account-export") {
      const user = requireAuth(request);
      return json(await service.requestAccountExport(user.id), 202, {
        "cache-control": "no-store",
      });
    }

    if (method === "POST" && path === "/account/export") {
      const result = await service.exportAccountData(trimmedString(body.token));

      return result.status === "exported"
        ? json(result, 200, { "cache-control": "no-store" })
        : json(
            {
              error: "invalid_or_expired_token",
              message: "The export link is invalid or has expired.",
            },
            400,
            { "cache-control": "no-store" },
          );
    }

    if (method === "DELETE" && path === "/me") {
      const user = requireAuth(request);
      const result = await service.deleteAccount({
        confirmationUsername: trimmedString(body.confirmationUsername),
        userId: user.id,
      });

      if (result.status === "confirmation_mismatch") {
        throw new ApiError(
          400,
          "confirmation_mismatch",
          "Enter your username exactly to delete the account.",
        );
      }

      if (result.status === "not_found") {
        throw new ApiError(404, "user_not_found", "User not found.");
      }

      return json(
        {
          deleted: true,
        },
        200,
        {
          "cache-control": "no-store",
          "set-cookie": clearSessionCookie(),
        },
      );
    }
  } catch (error) {
    toPostgresApiError(error);
  }

  return undefined;
}
