import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { User } from "@closetsearch/shared";
import {
  clearAuthSessions,
  findAuthSessionByTokenHash,
  insertAuthSession,
  revokeAuthSessionByTokenHash,
  revokeAuthSessionsByUserId,
  touchAuthSession,
  type AuthSessionRecord,
} from "../db/repositories/auth-sessions.js";
import { getUserById } from "../user-service.js";
import { getAuthConfig } from "./config.js";

export interface CreatedAuthSession {
  cookieValue: string;
  session: AuthSessionRecord;
}

export type AuthSessionResolution =
  | {
      status: "authenticated";
      session: AuthSessionRecord;
      token: string;
      user: User;
    }
  | {
      status: "missing" | "session_expired";
    };

function toHeaderString(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined;
  }

  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function parseCookieHeader(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return new Map<string, string>();
  }

  const cookies = new Map<string, string>();

  for (const cookiePart of cookieHeader.split(";")) {
    const separatorIndex = cookiePart.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = cookiePart.slice(0, separatorIndex).trim();
    const value = cookiePart.slice(separatorIndex + 1).trim();

    if (key) {
      cookies.set(key, decodeURIComponent(value));
    }
  }

  return cookies;
}

export function hashSessionToken(token: string) {
  const authConfig = getAuthConfig();

  return createHash("sha256")
    .update(authConfig.tokenPepper)
    .update(":")
    .update(token)
    .digest("hex");
}

export function formatSessionCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
) {
  const authConfig = getAuthConfig();
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
  ];

  if (authConfig.cookieSecure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function resolveSessionIpHint(request: IncomingMessage) {
  const forwardedFor = toHeaderString(request.headers?.["x-forwarded-for"]);

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || undefined;
  }

  return request.socket?.remoteAddress?.trim() || undefined;
}

export function getSessionTokenFromRequest(request: IncomingMessage) {
  const authConfig = getAuthConfig();
  const cookies = parseCookieHeader(toHeaderString(request.headers?.cookie));

  return cookies.get(authConfig.cookieName);
}

export function createAuthSession(
  userId: string,
  request: IncomingMessage,
): CreatedAuthSession {
  const authConfig = getAuthConfig();
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const createdAtIso = createdAt.toISOString();
  const expiresAt = new Date(createdAt.getTime() + authConfig.sessionTtlMs);
  const session: AuthSessionRecord = {
    createdAt: createdAtIso,
    expiresAt: expiresAt.toISOString(),
    id: randomUUID(),
    ipHint: resolveSessionIpHint(request),
    lastSeenAt: createdAtIso,
    sessionTokenHash: hashSessionToken(token),
    userAgent: toHeaderString(request.headers?.["user-agent"]),
    userId,
  };

  insertAuthSession(session);

  return {
    cookieValue: formatSessionCookie(
      authConfig.cookieName,
      token,
      authConfig.sessionTtlSeconds,
    ),
    session,
  };
}

export function clearSessionCookie() {
  const authConfig = getAuthConfig();

  return formatSessionCookie(authConfig.cookieName, "", 0);
}

export function revokeCurrentSession(request: IncomingMessage) {
  const token = getSessionTokenFromRequest(request);

  if (!token) {
    return false;
  }

  return revokeAuthSessionByTokenHash(hashSessionToken(token), new Date().toISOString());
}

export function revokeAllSessionsForUser(userId: string) {
  return revokeAuthSessionsByUserId(userId, new Date().toISOString());
}

export function getAuthSessionFromRequest(
  request: IncomingMessage,
): AuthSessionResolution {
  const token = getSessionTokenFromRequest(request);

  if (!token) {
    return {
      status: "missing",
    };
  }

  const session = findAuthSessionByTokenHash(hashSessionToken(token));

  if (!session) {
    return {
      status: "session_expired",
    };
  }

  const now = new Date().toISOString();

  if (session.revokedAt || session.expiresAt <= now) {
    return {
      status: "session_expired",
    };
  }

  const user = getUserById(session.userId);

  if (!user) {
    return {
      status: "session_expired",
    };
  }

  touchAuthSession(session.id, now);

  return {
    session,
    status: "authenticated",
    token,
    user,
  };
}

export function resetAuthSessionStore() {
  clearAuthSessions();
}
