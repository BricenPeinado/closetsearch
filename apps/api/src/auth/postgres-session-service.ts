import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { setPreparedAuthContext } from "./auth-context.js";
import { getAuthConfig } from "./config.js";
import {
  formatSessionCookie,
  getSessionTokenFromRequest,
  hashSessionToken,
  resolveSessionIpHint,
} from "./session-service.js";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { resolvePersistenceDriver } from "../db/persistence-driver.js";
import { getPostgresDataPlane } from "../db/persistence-runtime.js";

function toHeaderString(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined;
  }

  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export async function createPostgresAuthSession(
  dataPlane: PostgresDataPlane,
  userId: string,
  request: IncomingMessage,
) {
  const authConfig = getAuthConfig();
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + authConfig.sessionTtlMs);
  const session = await dataPlane.requestStore.createAuthSession({
    createdAt,
    expiresAt,
    ipHint: resolveSessionIpHint(request),
    sessionTokenHash: hashSessionToken(token),
    userAgent: toHeaderString(request.headers?.["user-agent"]),
    userId,
  });

  return {
    cookieValue: formatSessionCookie(
      authConfig.cookieName,
      token,
      authConfig.sessionTtlSeconds,
    ),
    session,
  };
}

export async function prepareRequestAuthContext(request: IncomingMessage) {
  if (resolvePersistenceDriver() !== "postgres") {
    return;
  }

  const token = getSessionTokenFromRequest(request);

  if (!token) {
    setPreparedAuthContext(request, { status: "missing" });
    return;
  }

  const dataPlane = await getPostgresDataPlane();
  const tokenHash = hashSessionToken(token);
  const session =
    await dataPlane.requestStore.resolveAuthSessionByTokenHash(tokenHash);

  if (!session) {
    setPreparedAuthContext(request, { status: "session_expired" });
    return;
  }

  const user = await dataPlane.requestStore.findUserById(session.userId);

  if (!user) {
    setPreparedAuthContext(request, { status: "session_expired" });
    return;
  }

  const touchedSession =
    (await dataPlane.requestStore.touchAuthSession(session.id)) ?? session;
  setPreparedAuthContext(request, {
    session: touchedSession,
    status: "authenticated",
    user,
  });
}

export async function revokePostgresCurrentSession(
  dataPlane: PostgresDataPlane,
  request: IncomingMessage,
) {
  const token = getSessionTokenFromRequest(request);

  if (!token) {
    return false;
  }

  return dataPlane.requestStore.revokeAuthSessionByTokenHash(
    hashSessionToken(token),
  );
}
