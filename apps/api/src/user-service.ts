import { randomUUID } from "node:crypto";
import type {
  AuthResponse,
  OnboardingPreferences,
  StoredUser,
  User,
} from "@closetsearch/shared";
import { ApiError } from "./api-error.js";
import { hashPassword, verifyPassword } from "./auth/password-service.js";
import {
  clearUsers,
  findUserById,
  findUserByNormalizedUsername,
  insertUser,
  updateUserPasswordHash,
  updateUserPreferences,
} from "./db/repositories/users.js";

const defaultOnboardingPreferences: OnboardingPreferences = {
  favoriteBrands: [],
  categories: [],
  priceRange: "",
};

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
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

function toAuthResponse(user: StoredUser): AuthResponse {
  return {
    user: toPublicUser(user),
    userId: user.id,
  };
}

function validateUsername(username: string) {
  if (username.trim().length < 3) {
    throw new ApiError(400, "invalid_request", "Username must be at least 3 characters.");
  }
}

function validatePassword(password: string) {
  if (password.length < 8) {
    throw new ApiError(400, "invalid_request", "Password must be at least 8 characters.");
  }
}

export function resetUserStore() {
  clearUsers();
}

export function createUser(username: string, password: string) {
  const trimmedUsername = username.trim();
  const normalizedUsername = normalizeUsername(trimmedUsername);

  validateUsername(trimmedUsername);
  validatePassword(password);

  if (findUserByNormalizedUsername(normalizedUsername)) {
    throw new ApiError(409, "username_taken", "That username is already taken.");
  }

  const storedUser: StoredUser = {
    id: randomUUID(),
    username: trimmedUsername,
    passwordHash: hashPassword(password),
    onboardingPreferences: defaultOnboardingPreferences,
    currencyPreference: "USD",
    createdAt: new Date().toISOString(),
  };

  insertUser({
    ...storedUser,
    normalizedUsername,
  });

  return toAuthResponse(storedUser);
}

export function loginUser(username: string, password: string) {
  const normalizedUsername = normalizeUsername(username);
  const existingUser = findUserByNormalizedUsername(normalizedUsername);

  if (!existingUser) {
    throw new ApiError(401, "invalid_credentials", "Invalid username or password.");
  }

  const verification = verifyPassword(existingUser.passwordHash, password);

  if (!verification.isValid) {
    throw new ApiError(401, "invalid_credentials", "Invalid username or password.");
  }

  const upgradedUser = verification.needsRehash && verification.upgradedHash
    ? updateUserPasswordHash(existingUser.id, verification.upgradedHash) ?? {
        ...existingUser,
        passwordHash: verification.upgradedHash,
      }
    : existingUser;

  return toAuthResponse(upgradedUser);
}

export function saveOnboardingPreferences(
  userId: string,
  preferences: OnboardingPreferences,
  currencyPreference = "USD",
) {
  const updatedUser = updateUserPreferences(userId, preferences, currencyPreference);

  if (!updatedUser) {
    throw new ApiError(404, "user_not_found", "User not found.");
  }

  return toAuthResponse(updatedUser);
}

export function getUserById(userId: string) {
  const storedUser = findUserById(userId);

  return storedUser ? toPublicUser(storedUser) : undefined;
}
