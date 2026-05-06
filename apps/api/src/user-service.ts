import { createHash, randomUUID } from "node:crypto";
import type {
  AuthResponse,
  OnboardingPreferences,
  StoredUser,
  User,
} from "@closetsearch/shared";

const defaultPreferences: OnboardingPreferences = {
  favoriteBrands: [],
  categories: [],
  priceRange: "",
};

const defaultCurrencyPreference = "USD";
const usersById = new Map<string, StoredUser>();
const userIdsByUsername = new Map<string, string>();

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
  usersById.clear();
  userIdsByUsername.clear();
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

  if (userIdsByUsername.has(normalizedUsername)) {
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

  usersById.set(user.id, user);
  userIdsByUsername.set(normalizedUsername, user.id);

  return {
    userId: user.id,
    user: toPublicUser(user),
  };
}

export function loginUser(username: string, password: string): AuthResponse {
  const userId = userIdsByUsername.get(normalizeUsername(username));

  if (!userId) {
    throw new Error("Invalid username or password.");
  }

  const user = usersById.get(userId);

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
  const user = usersById.get(userId);

  if (!user) {
    throw new Error("User not found.");
  }

  const nextUser: StoredUser = {
    ...user,
    onboardingPreferences: {
      favoriteBrands: preferences.favoriteBrands,
      categories: preferences.categories,
      priceRange: preferences.priceRange,
    },
    currencyPreference: currencyPreference?.trim() || user.currencyPreference,
  };

  usersById.set(userId, nextUser);

  return {
    userId: nextUser.id,
    user: toPublicUser(nextUser),
  };
}

export function getUserById(userId: string) {
  const user = usersById.get(userId);

  return user ? toPublicUser(user) : undefined;
}
