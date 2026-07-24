import { createUser } from "../user-service.js";
import {
  assertPasswordPolicy,
  type PasswordPolicyOptions,
} from "./password-policy.js";

export async function registerUserWithPasswordPolicy(
  username: string,
  password: string,
  passwordPolicy: PasswordPolicyOptions = {},
) {
  await assertPasswordPolicy(
    password,
    {
      username,
    },
    passwordPolicy,
  );

  return createUser(username, password);
}
