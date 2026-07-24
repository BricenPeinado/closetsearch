import { ApiError } from "../api-error.js";
import { resolvePersistenceDriver } from "../db/persistence-driver.js";
import { getPostgresDataPlane } from "../db/persistence-runtime.js";
import {
  RequestStoreError,
  type PostgresDataPlane,
} from "../db/postgres/index.js";
import { PasswordPolicyError } from "../auth/password-policy.js";
import { AccountSecurityError } from "../auth/account-security-error.js";

export function isPostgresRequestPath() {
  return resolvePersistenceDriver() === "postgres";
}

export function getRequestDataPlane(): Promise<PostgresDataPlane> {
  return getPostgresDataPlane();
}

export function toPostgresApiError(error: unknown): never {
  if (error instanceof ApiError) {
    throw error;
  }

  if (error instanceof PasswordPolicyError) {
    throw new ApiError(
      400,
      "password_policy_failed",
      error.violations[0]?.message ?? "Password does not meet the policy.",
    );
  }

  if (error instanceof AccountSecurityError) {
    const statusCode =
      error.code === "email_in_use"
        ? 409
        : error.code === "user_not_found"
          ? 404
          : error.code === "email_missing" ||
              error.code === "email_not_verified"
            ? 409
            : 400;
    throw new ApiError(statusCode, error.code, error.message);
  }

  if (error instanceof RequestStoreError) {
    const conflictCodes = new Set([
      "account_token_conflict",
      "email_in_use",
      "listing_not_persisted",
      "username_taken",
      "watchlist_conflict",
    ]);

    throw new ApiError(
      conflictCodes.has(error.code) ? 409 : 400,
      error.code,
      error.message,
    );
  }

  throw error;
}

export function trimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

export function pathId(pathname: string, basePath: string) {
  if (!pathname.startsWith(`${basePath}/`)) {
    return undefined;
  }

  return decodeURIComponent(pathname.slice(basePath.length + 1)).trim() || undefined;
}
