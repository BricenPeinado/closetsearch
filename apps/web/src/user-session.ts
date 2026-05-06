import type { AuthResponse } from "@closetsearch/shared";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const USER_SESSION_STORAGE_KEY = "closetsearch.user-session";

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const user =
    candidate.user && typeof candidate.user === "object"
      ? (candidate.user as Record<string, unknown>)
      : null;

  return (
    typeof candidate.userId === "string" &&
    !!user &&
    typeof user.id === "string" &&
    typeof user.username === "string" &&
    typeof user.currencyPreference === "string" &&
    typeof user.createdAt === "string"
  );
}

export function loadUserSession(storage = getBrowserStorage()) {
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(USER_SESSION_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as unknown;

    return isAuthResponse(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
}

export function saveUserSession(session: AuthResponse, storage = getBrowserStorage()) {
  storage?.setItem(USER_SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function clearUserSession(storage = getBrowserStorage()) {
  storage?.removeItem(USER_SESSION_STORAGE_KEY);
}
