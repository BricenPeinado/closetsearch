import { createHash } from "node:crypto";
import type { OnboardingPreferences } from "@closetsearch/shared";
import { RequestStoreError } from "./request-store-types.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const currencyPattern = /^[A-Z]{3}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const defaultOnboardingPreferences: OnboardingPreferences = {
  categories: [],
  favoriteBrands: [],
  priceRange: "",
};

export function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new RequestStoreError("invalid_identifier", "A persisted timestamp was invalid.");
  }

  return date.toISOString();
}

export function parseJsonObject(value: unknown) {
  if (!value) {
    return {} as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseJsonArray(value: unknown) {
  if (!value) {
    return [] as unknown[];
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return Array.isArray(value) ? value : [];
}

export function parseOnboardingPreferences(value: unknown): OnboardingPreferences {
  const parsed = parseJsonObject(value);

  return {
    categories: Array.isArray(parsed.categories)
      ? parsed.categories.filter((entry): entry is string => typeof entry === "string")
      : [],
    favoriteBrands: Array.isArray(parsed.favoriteBrands)
      ? parsed.favoriteBrands.filter((entry): entry is string => typeof entry === "string")
      : [],
    priceRange: typeof parsed.priceRange === "string" ? parsed.priceRange : "",
  };
}

export function normalizeOnboardingPreferences(value: OnboardingPreferences | undefined) {
  const preferences = value ?? defaultOnboardingPreferences;
  const normalizeValues = (values: string[]) =>
    Array.from(
      new Set(
        values
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0 && entry.length <= 160),
      ),
    ).slice(0, 100);

  return {
    categories: normalizeValues(preferences.categories),
    favoriteBrands: normalizeValues(preferences.favoriteBrands),
    priceRange: preferences.priceRange.trim().slice(0, 160),
  } satisfies OnboardingPreferences;
}

export function normalizeUsername(value: string) {
  const username = value.trim();

  if (username.length === 0 || username.length > 80 || hasControlCharacters(username)) {
    throw new RequestStoreError(
      "invalid_username",
      "Username must contain between 1 and 80 visible characters.",
    );
  }

  return {
    normalizedUsername: username.toLowerCase(),
    username,
  };
}

export function normalizeCurrency(value: string | undefined, fallback = "USD") {
  const currency = (value?.trim() || fallback).toUpperCase();

  if (!currencyPattern.test(currency)) {
    throw new RequestStoreError("invalid_currency", "Currency must be a three-letter ISO code.");
  }

  return currency;
}

export function assertUuid(value: string, label: string) {
  if (!uuidPattern.test(value)) {
    throw new RequestStoreError("invalid_identifier", `${label} must be a UUID.`);
  }

  return value.toLowerCase();
}

export function normalizeBoundedString(value: string | null | undefined, maximumLength: number) {
  const normalized = value?.trim();

  if (!normalized || normalized.length > maximumLength || hasControlCharacters(normalized)) {
    return undefined;
  }

  return normalized;
}

export function requiredBoundedString(
  value: string | null | undefined,
  maximumLength: number,
  code: "invalid_saved_feature" | "invalid_watchlist",
  label: string,
) {
  const normalized = normalizeBoundedString(value, maximumLength);

  if (!normalized) {
    throw new RequestStoreError(
      code,
      `${label} must contain between 1 and ${maximumLength} visible characters.`,
    );
  }

  return normalized;
}

export function normalizeHash(
  value: string,
  code: "invalid_account_token" | "invalid_password_hash" | "invalid_session",
  label: string,
) {
  const hash = value.trim();

  if (hash.length < 32 || hash.length > 256 || hasControlCharacters(hash)) {
    throw new RequestStoreError(code, `${label} must be a bounded one-way hash.`);
  }

  return hash;
}

export function validateQuietHours(
  start: string | null | undefined,
  end: string | null | undefined,
) {
  const normalizedStart = start === null ? undefined : normalizeBoundedString(start, 5);
  const normalizedEnd = end === null ? undefined : normalizeBoundedString(end, 5);

  if (
    Boolean(normalizedStart) !== Boolean(normalizedEnd) ||
    (normalizedStart && !timePattern.test(normalizedStart)) ||
    (normalizedEnd && !timePattern.test(normalizedEnd))
  ) {
    throw new RequestStoreError(
      "invalid_notification_preferences",
      "Quiet hours must contain both start and end in HH:MM format.",
    );
  }

  return {
    end: normalizedEnd,
    start: normalizedStart,
  };
}

export function sha256(...parts: string[]) {
  const hash = createHash("sha256");

  for (const part of parts) {
    hash.update(part.length.toString(10));
    hash.update(":");
    hash.update(part);
    hash.update("|");
  }

  return hash.digest("hex");
}

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function isUniqueViolation(error: unknown) {
  return (
    error !== null && typeof error === "object" && (error as { code?: unknown }).code === "23505"
  );
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}
