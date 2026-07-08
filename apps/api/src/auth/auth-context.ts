import type { IncomingMessage } from "node:http";
import type { User } from "@closetsearch/shared";
import { ApiError } from "../api-error.js";
import {
  getAuthSessionFromRequest,
  type AuthSessionResolution,
} from "./session-service.js";

export function getOptionalAuthContext(request: IncomingMessage) {
  const authSession = getAuthSessionFromRequest(request);

  return authSession.status === "authenticated" ? authSession : null;
}

export function requireAuth(request: IncomingMessage): User {
  const authSession = getAuthSessionFromRequest(request);

  if (authSession.status === "authenticated") {
    return authSession.user;
  }

  if (authSession.status === "missing") {
    throw new ApiError(401, "unauthenticated", "You must be logged in to continue.");
  }

  throw new ApiError(
    401,
    "session_expired",
    "Your session has expired. Please log in again.",
  );
}

export function shouldClearSessionCookie(
  authSession: AuthSessionResolution | null,
) {
  return authSession?.status === "session_expired";
}
