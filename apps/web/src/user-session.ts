import type { AuthResponse } from "@closetsearch/shared";
import { ApiClientError, fetchJson } from "./api-client";

export async function loadUserSession(signal?: AbortSignal) {
  try {
    return await fetchJson<AuthResponse>("/auth/me", signal);
  } catch (error) {
    if (isAuthRequiredError(error)) {
      return null;
    }

    throw error;
  }
}

export function isAuthRequiredError(error: unknown) {
  return (
    error instanceof ApiClientError &&
    (error.code === "session_expired" || error.code === "unauthenticated")
  );
}

export function getAuthErrorMessage(
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case "invalid_credentials":
        return "Invalid username or password.";
      case "username_taken":
        return "That username is already taken.";
      case "session_expired":
        return "Your session expired. Please log in again.";
      case "unauthenticated":
        return "Please log in to continue.";
      default:
        return error.message;
    }
  }

  return error instanceof Error ? error.message : fallbackMessage;
}
