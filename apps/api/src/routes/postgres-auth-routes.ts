import type { IncomingMessage } from "node:http";
import type { OnboardingPreferences } from "@closetsearch/shared";
import { ApiError } from "../api-error.js";
import { getAuthSessionResolution, requireAuth } from "../auth/auth-context.js";
import { assertPasswordPolicy } from "../auth/password-policy.js";
import { hashPassword, verifyPassword } from "../auth/password-service.js";
import {
  createPostgresAuthSession,
  revokePostgresCurrentSession,
} from "../auth/postgres-session-service.js";
import { clearSessionCookie } from "../auth/session-service.js";
import { parseJsonRequestBody } from "../http/request-body.js";
import { FixedWindowRateLimiter, getRequestIpHint } from "../http/rate-limit.js";
import type { RouteResult } from "./route-result.js";
import {
  getRequestDataPlane,
  isPostgresRequestPath,
  stringArray,
  toPostgresApiError,
  trimmedString,
} from "./postgres-route-support.js";

const postgresAuthRateLimiter = new FixedWindowRateLimiter({
  limit: 10,
  windowMs: 60_000,
});

function authResponse(user: {
  createdAt: string;
  currencyPreference: string;
  id: string;
  onboardingPreferences: OnboardingPreferences;
  username: string;
}) {
  return {
    user,
    userId: user.id,
  };
}

function onboardingPreferences(value: unknown): OnboardingPreferences {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    categories: stringArray(input.categories),
    favoriteBrands: stringArray(input.favoriteBrands),
    priceRange: trimmedString(input.priceRange),
  };
}

async function payload(request: IncomingMessage) {
  const raw = await parseJsonRequestBody(request);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "invalid_request", "A JSON object is required.");
  }

  return raw as Record<string, unknown>;
}

export async function handlePostgresAuthRoute(
  request: IncomingMessage,
  requestUrl: URL,
): Promise<RouteResult | undefined> {
  if (!isPostgresRequestPath()) {
    return undefined;
  }

  const method = request.method ?? "GET";
  const path = requestUrl.pathname;

  try {
    if (method === "POST" && path === "/auth/signup") {
      postgresAuthRateLimiter.consume(`postgres-signup:${getRequestIpHint(request)}`);
      const body = await payload(request);
      const username = trimmedString(body.username);
      const password = typeof body.password === "string" ? body.password : "";

      if (!username || !password) {
        throw new ApiError(400, "invalid_request", "Username and password are required.");
      }

      await assertPasswordPolicy(password, { username });
      const dataPlane = await getRequestDataPlane();
      const user = await dataPlane.requestStore.createUser({
        passwordHash: hashPassword(password),
        username,
      });
      const session = await createPostgresAuthSession(dataPlane, user.id, request);

      return {
        body: authResponse(user),
        headers: {
          "cache-control": "no-store",
          "set-cookie": session.cookieValue,
        },
        kind: "json",
        statusCode: 201,
      };
    }

    if (method === "POST" && path === "/auth/login") {
      postgresAuthRateLimiter.consume(`postgres-login:${getRequestIpHint(request)}`);
      const body = await payload(request);
      const username = trimmedString(body.username);
      const password = typeof body.password === "string" ? body.password : "";

      if (!username || !password) {
        throw new ApiError(400, "invalid_request", "Username and password are required.");
      }

      const dataPlane = await getRequestDataPlane();
      const credentials = await dataPlane.requestStore.findUserCredentialsByNormalizedUsername(
        username.toLowerCase(),
      );

      if (!credentials) {
        throw new ApiError(401, "invalid_credentials", "Invalid username or password.");
      }

      const verification = verifyPassword(credentials.passwordHash, password);

      if (!verification.isValid) {
        throw new ApiError(401, "invalid_credentials", "Invalid username or password.");
      }

      if (verification.needsRehash && verification.upgradedHash) {
        await dataPlane.requestStore.updatePasswordHash(credentials.id, verification.upgradedHash);
      }

      const { passwordHash: _passwordHash, ...user } = credentials;
      const session = await createPostgresAuthSession(dataPlane, user.id, request);

      return {
        body: authResponse(user),
        headers: {
          "cache-control": "no-store",
          "set-cookie": session.cookieValue,
        },
        kind: "json",
        statusCode: 200,
      };
    }

    if (method === "GET" && path === "/auth/me") {
      const resolution = getAuthSessionResolution(request);

      if (resolution.status !== "authenticated") {
        return {
          body: {
            error: resolution.status === "missing" ? "unauthenticated" : "session_expired",
            message:
              resolution.status === "missing"
                ? "You are not logged in."
                : "Your session has expired. Please log in again.",
          },
          headers: {
            "cache-control": "no-store",
            ...(resolution.status === "session_expired"
              ? { "set-cookie": clearSessionCookie() }
              : {}),
          },
          kind: "json",
          statusCode: 401,
        };
      }

      return {
        body: authResponse(resolution.user),
        headers: { "cache-control": "no-store" },
        kind: "json",
        statusCode: 200,
      };
    }

    if (method === "POST" && path === "/auth/logout") {
      const dataPlane = await getRequestDataPlane();
      await revokePostgresCurrentSession(dataPlane, request);

      return {
        body: { success: true },
        headers: {
          "cache-control": "no-store",
          "set-cookie": clearSessionCookie(),
        },
        kind: "json",
        statusCode: 200,
      };
    }

    if (method === "POST" && path === "/auth/logout-all") {
      const user = requireAuth(request);
      const dataPlane = await getRequestDataPlane();
      const revokedSessions = await dataPlane.requestStore.revokeAuthSessionsByUserId(user.id);

      return {
        body: { revokedSessions, success: true },
        headers: {
          "cache-control": "no-store",
          "set-cookie": clearSessionCookie(),
        },
        kind: "json",
        statusCode: 200,
      };
    }

    if (method === "POST" && path === "/users/onboarding") {
      const user = requireAuth(request);
      const body = await payload(request);
      const dataPlane = await getRequestDataPlane();
      const updatedUser = await dataPlane.requestStore.updateOnboarding(
        user.id,
        onboardingPreferences(body.preferences),
        trimmedString(body.currencyPreference) || "USD",
      );

      if (!updatedUser) {
        throw new ApiError(404, "user_not_found", "User not found.");
      }

      return {
        body: authResponse(updatedUser),
        headers: { "cache-control": "no-store" },
        kind: "json",
        statusCode: 200,
      };
    }
  } catch (error) {
    toPostgresApiError(error);
  }

  return undefined;
}
