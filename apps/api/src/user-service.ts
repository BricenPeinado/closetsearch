import { createHash, randomUUID } from "node:crypto";
import type {
  AuthResponse,
  OnboardingPreferences,
  StoredUser,
  User,
} from "@closetsearch/shared";
import {
  clearUsers,
  findUserById,
  findUserByNormalizedUsername,
  insertUser,
  updateUserPreferences,
} from "./db/repositories/users.js";

const defaultPreferences: OnboardingPreferences = {
  favoriteBrands: [],
  categories: [],
  priceRange: "",
};

const defaultCurrencyPreference = "USD";

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function validateUsername(username: string) {
  return username.trim().length >= 3;
}

function validatePassword(password: string) {
  return password.length >= 4;
}

function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

function toPublicUser(user: StoredUser): User {
  return {
    id: user.id,
    username: user.username,
    onboardingPreferences: user.onboardingPreferences,
    currencyPreference: user.currencyPreference,
    createdAt: user.createdAt,
  };
}

export function resetUserStore() {
  clearUsers();
}

export function createUser(username: string, password: string): AuthResponse {
  const trimmedUsername = username.trim();
  const normalizedUsername = normalizeUsername(trimmedUsername);

  if (!validateUsername(trimmedUsername)) {
    throw new Error("Username must be at least 3 characters long.");
  }

  if (!validatePassword(password)) {
    throw new Error("Password must be at least 4 characters long.");
  }

  if (findUserByNormalizedUsername(normalizedUsername)) {
    throw new Error("That username is already taken.");
  }

  const user: StoredUser = {
    id: randomUUID(),
    username: trimmedUsername,
    passwordHash: hashPassword(password),
    onboardingPreferences: {
      favoriteBrands: [...defaultPreferences.favoriteBrands],
      categories: [...defaultPreferences.categories],
      priceRange: defaultPreferences.priceRange,
    },
    currencyPreference: defaultCurrencyPreference,
    createdAt: new Date().toISOString(),
  };

  insertUser({
    id: user.id,
    username: user.username,
    normalizedUsername,
    passwordHash: user.passwordHash,
    onboardingPreferences: user.onboardingPreferences,
    currencyPreference: user.currencyPreference,
    createdAt: user.createdAt,
  });

  return {
    userId: user.id,
    user: toPublicUser(user),
  };
}

export function loginUser(username: string, password: string): AuthResponse {
  const user = findUserByNormalizedUsername(normalizeUsername(username));

  if (!user || user.passwordHash !== hashPassword(password)) {
    throw new Error("Invalid username or password.");
  }

  return {
    userId: user.id,
    user: toPublicUser(user),
  };
}

export function saveOnboardingPreferences(
  userId: string,
  preferences: OnboardingPreferences,
  currencyPreference?: string,
) {
  const user = findUserById(userId);

  if (!user) {
    throw new Error("User not found.");
  }

  const nextUser = updateUserPreferences(
    userId,
    {
      favoriteBrands: preferences.favoriteBrands,
      categories: preferences.categories,
      priceRange: preferences.priceRange,
    },
    currencyPreference?.trim() || user.currencyPreference,
  );

  if (!nextUser) {
    throw new Error("User not found.");
  }

  return {
    userId: nextUser.id,
    user: toPublicUser(nextUser),
  };
}

export function getUserById(userId: string) {
  const user = findUserById(userId);
  return user ? toPublicUser(user) : undefined;
}
