export class ApiError extends Error {
  code: string;
  statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
