export type AccountSecurityErrorCode =
  | "email_in_use"
  | "email_missing"
  | "email_not_verified"
  | "invalid_email"
  | "password_policy_failed"
  | "user_not_found";

export class AccountSecurityError extends Error {
  code: AccountSecurityErrorCode;

  constructor(code: AccountSecurityErrorCode, message: string) {
    super(message);
    this.name = "AccountSecurityError";
    this.code = code;
  }
}
