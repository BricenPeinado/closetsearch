const commonPasswords = new Set([
  "123456789012",
  "closetsearch",
  "iloveyou123",
  "letmein123456",
  "password1234",
  "qwerty123456",
]);

export type PasswordPolicyViolationCode =
  | "breached_password"
  | "breach_check_unavailable"
  | "contains_account_identifier"
  | "control_character"
  | "known_common_password"
  | "too_long"
  | "too_short";

export interface PasswordPolicyViolation {
  code: PasswordPolicyViolationCode;
  message: string;
}

export type BreachedPasswordCheckResult =
  | {
      occurrenceCount?: number;
      status: "breached";
    }
  | {
      status: "safe";
    }
  | {
      reason: string;
      status: "unavailable";
    };

export interface BreachedPasswordChecker {
  check(password: string): Promise<BreachedPasswordCheckResult>;
}

export const disabledBreachedPasswordChecker: BreachedPasswordChecker = {
  async check() {
    return {
      reason: "No approved breached-password provider is configured.",
      status: "unavailable",
    };
  },
};

export interface PasswordPolicyContext {
  email?: string;
  username?: string;
}

export interface PasswordPolicyOptions {
  breachedPasswordChecker?: BreachedPasswordChecker;
  maximumLength?: number;
  minimumLength?: number;
  requireBreachedPasswordCheck?: boolean;
}

export interface PasswordPolicyResult {
  accepted: boolean;
  breachCheck: BreachedPasswordCheckResult;
  violations: PasswordPolicyViolation[];
}

export class PasswordPolicyError extends Error {
  violations: PasswordPolicyViolation[];

  constructor(violations: PasswordPolicyViolation[]) {
    super(violations[0]?.message ?? "Password does not meet the policy.");
    this.name = "PasswordPolicyError";
    this.violations = violations;
  }
}

function accountIdentifiers(context: PasswordPolicyContext) {
  const username = context.username?.trim().toLowerCase();
  const emailLocalPart = context.email?.trim().toLowerCase().split("@")[0];

  return [username, emailLocalPart].filter((value): value is string =>
    Boolean(value && value.length >= 3),
  );
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export async function evaluatePasswordPolicy(
  password: string,
  context: PasswordPolicyContext = {},
  options: PasswordPolicyOptions = {},
): Promise<PasswordPolicyResult> {
  const minimumLength = options.minimumLength ?? 12;
  const maximumLength = options.maximumLength ?? 128;
  const comparablePassword = password.normalize("NFKC").toLowerCase();
  const passwordLength = Array.from(password).length;
  const violations: PasswordPolicyViolation[] = [];

  if (passwordLength < minimumLength) {
    violations.push({
      code: "too_short",
      message: `Password must be at least ${minimumLength} characters.`,
    });
  }

  if (passwordLength > maximumLength) {
    violations.push({
      code: "too_long",
      message: `Password must be at most ${maximumLength} characters.`,
    });
  }

  if (hasControlCharacters(password)) {
    violations.push({
      code: "control_character",
      message: "Password cannot contain control characters.",
    });
  }

  if (commonPasswords.has(comparablePassword)) {
    violations.push({
      code: "known_common_password",
      message: "Choose a less common password.",
    });
  }

  if (
    accountIdentifiers(context).some((identifier) =>
      comparablePassword.includes(identifier.normalize("NFKC")),
    )
  ) {
    violations.push({
      code: "contains_account_identifier",
      message: "Password cannot contain your username or email name.",
    });
  }

  const checker = options.breachedPasswordChecker ?? disabledBreachedPasswordChecker;
  const breachCheck = await checker.check(password);

  if (breachCheck.status === "breached") {
    violations.push({
      code: "breached_password",
      message: "Choose a password that has not appeared in a known breach.",
    });
  } else if (breachCheck.status === "unavailable" && options.requireBreachedPasswordCheck) {
    violations.push({
      code: "breach_check_unavailable",
      message: "Password safety validation is temporarily unavailable.",
    });
  }

  return {
    accepted: violations.length === 0,
    breachCheck,
    violations,
  };
}

export async function assertPasswordPolicy(
  password: string,
  context: PasswordPolicyContext = {},
  options: PasswordPolicyOptions = {},
) {
  const result = await evaluatePasswordPolicy(password, context, options);

  if (!result.accepted) {
    throw new PasswordPolicyError(result.violations);
  }

  return result;
}
