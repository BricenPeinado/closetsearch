export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

interface ParsedError {
  code: string;
  message: string;
}

export class ApiClientError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

function getSafeErrorMessage(status: number, code: string, message?: string) {
  switch (code) {
    case "feed_unavailable":
      return "The feed is temporarily unavailable. Marketplace coverage may be limited right now. Please try again.";
    case "search_unavailable":
      return "Search is temporarily unavailable. Results may be limited right now. Please try again.";
    case "network_error":
      return "ClosetSearch could not reach the server. Check your connection and try again.";
    case "invalid_credentials":
      return "Invalid username or password.";
    case "username_taken":
      return "That username is already taken.";
    case "email_in_use":
      return "That email address is already attached to another account.";
    case "email_missing":
      return "Add an email address before requesting verification.";
    case "email_not_verified":
      return "Verify your email address before requesting an account export.";
    case "invalid_email":
      return "Enter a valid email address.";
    case "invalid_or_expired_token":
      return "This one-time link is invalid or has expired. Request a new link.";
    case "password_policy_failed":
      return message ?? "Choose a password that meets the account security requirements.";
    case "confirmation_mismatch":
      return "Enter your username exactly to delete the account.";
    case "session_expired":
      return "Your session expired. Please log in again.";
    case "unauthenticated":
      return "Please log in to continue.";
    default:
      if (status >= 500) {
        return "The request could not be completed right now. Please try again.";
      }

      return message ?? "The request could not be completed.";
  }
}

async function parseError(response: Response): Promise<ParsedError> {
  const errorBody = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  const code = errorBody?.error ?? "request_failed";

  return {
    code,
    message: getSafeErrorMessage(response.status, code, errorBody?.message),
  };
}

async function requestJson<T>(
  path: string,
  init: Omit<RequestInit, "credentials"> = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    throw new ApiClientError(0, "network_error", getSafeErrorMessage(0, "network_error"));
  }

  if (!response.ok) {
    const error = await parseError(response);
    throw new ApiClientError(response.status, error.code, error.message);
  }

  return (await response.json()) as T;
}

export async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, { signal });
}

export async function sendJson<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
): Promise<T> {
  return requestJson<T>(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method,
  });
}
