import type { IncomingMessage } from "node:http";
import type { User } from "@closetsearch/shared";
import { ApiError } from "../api-error.js";
import { getAuthSessionFromRequest, type AuthSessionResolution } from "./session-service.js";

export type PreparedAuthSessionResolution =
  | {
      status: "authenticated";
      session: {
        createdAt: string;
        expiresAt: string;
        id: string;
        lastSeenAt: string;
        revokedAt?: string;
        userId: string;
      };
      user: User;
    }
  | {
      status: "missing" | "session_expired";
    };

const preparedAuthContexts = new WeakMap<IncomingMessage, PreparedAuthSessionResolution>();

export function setPreparedAuthContext(
  request: IncomingMessage,
  resolution: PreparedAuthSessionResolution,
) {
  preparedAuthContexts.set(request, resolution);
}

export function getAuthSessionResolution(
  request: IncomingMessage,
): AuthSessionResolution | PreparedAuthSessionResolution {
  return preparedAuthContexts.get(request) ?? getAuthSessionFromRequest(request);
}

export function getOptionalAuthContext(request: IncomingMessage) {
  const authSession = getAuthSessionResolution(request);

  return authSession.status === "authenticated" ? authSession : null;
}

export function requireAuth(request: IncomingMessage): User {
  const authSession = getAuthSessionResolution(request);

  if (authSession.status === "authenticated") {
    return authSession.user;
  }

  if (authSession.status === "missing") {
    throw new ApiError(401, "unauthenticated", "You must be logged in to continue.");
  }

  throw new ApiError(401, "session_expired", "Your session has expired. Please log in again.");
}

export function shouldClearSessionCookie(
  authSession: AuthSessionResolution | PreparedAuthSessionResolution | null,
) {
  return authSession?.status === "session_expired";
}
