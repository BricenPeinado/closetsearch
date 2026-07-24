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
  method: "POST" | "PATCH" | "DELETE",
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
