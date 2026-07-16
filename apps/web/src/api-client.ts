const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

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

async function parseError(response: Response): Promise<ParsedError> {
  const errorBody = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null;

  return {
    code: errorBody?.error ?? "request_failed",
    message: errorBody?.message ?? "The request could not be completed.",
  };
}

export async function fetchJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    const error = await parseError(response);
    throw new ApiClientError(response.status, error.code, error.message);
  }

  return (await response.json()) as T;
}

export async function sendJson<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    method,
  });

  if (!response.ok) {
    const error = await parseError(response);
    throw new ApiClientError(response.status, error.code, error.message);
  }

  return (await response.json()) as T;
}
