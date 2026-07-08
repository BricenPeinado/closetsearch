const defaultAllowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "true") {
    return true;
  }

  if (normalizedValue === "false") {
    return false;
  }

  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return parsedValue;
}

function parseAllowedOrigins(value: string | undefined) {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : defaultAllowedOrigins;
}

export interface AuthConfig {
  allowedOrigins: Set<string>;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtlDays: number;
  sessionTtlMs: number;
  sessionTtlSeconds: number;
  tokenPepper: string;
}

export function getAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthConfig {
  const sessionTtlDays = parsePositiveInteger(env.AUTH_SESSION_TTL_DAYS, 14);
  const cookieSecure = parseBoolean(
    env.AUTH_COOKIE_SECURE,
    env.NODE_ENV === "production",
  );

  return {
    allowedOrigins: new Set(parseAllowedOrigins(env.AUTH_ALLOWED_ORIGINS)),
    cookieName: env.AUTH_SESSION_COOKIE_NAME?.trim() || "closetsearch_session",
    cookieSecure,
    sessionTtlDays,
    sessionTtlMs: sessionTtlDays * 24 * 60 * 60 * 1_000,
    sessionTtlSeconds: sessionTtlDays * 24 * 60 * 60,
    tokenPepper:
      env.AUTH_SESSION_PEPPER?.trim() ??
      env.AUTH_TOKEN_PEPPER?.trim() ??
      "",
  };
}
