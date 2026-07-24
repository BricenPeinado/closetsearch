import { AccountSecurityError } from "./account-security-error.js";

const maximumEmailLength = 320;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export interface NormalizedEmailAddress {
  email: string;
  normalizedEmail: string;
}

export function normalizeEmailAddress(value: string): NormalizedEmailAddress {
  const email = value.trim();

  if (
    email.length < 3 ||
    email.length > maximumEmailLength ||
    hasControlCharacters(email) ||
    !emailPattern.test(email)
  ) {
    throw new AccountSecurityError("invalid_email", "Enter a valid email address.");
  }

  const atIndex = email.lastIndexOf("@");
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1).toLowerCase();
  const normalizedEmail = `${localPart.toLowerCase()}@${domain}`;

  return {
    email,
    normalizedEmail,
  };
}
