import { describe, expect, it } from "vitest";
import { evaluatePasswordPolicy, type BreachedPasswordChecker } from "./password-policy.js";

describe("password policy", () => {
  it("accepts long passphrases without requiring arbitrary character classes", async () => {
    const result = await evaluatePasswordPolicy("violet sparrow orbit lantern");

    expect(result).toMatchObject({
      accepted: true,
      breachCheck: {
        status: "unavailable",
      },
      violations: [],
    });
  });

  it("rejects common passwords and account identifiers", async () => {
    const commonResult = await evaluatePasswordPolicy("password1234");
    const identifierResult = await evaluatePasswordPolicy("ArchiveFan-has-a-long-password", {
      email: "closet@example.com",
      username: "archivefan",
    });

    expect(commonResult.violations.map(({ code }) => code)).toContain("known_common_password");
    expect(identifierResult.violations.map(({ code }) => code)).toContain(
      "contains_account_identifier",
    );
  });

  it("can fail closed when a breached-password provider is required", async () => {
    const result = await evaluatePasswordPolicy(
      "violet sparrow orbit lantern",
      {},
      {
        requireBreachedPasswordCheck: true,
      },
    );

    expect(result).toMatchObject({
      accepted: false,
      violations: [
        expect.objectContaining({
          code: "breach_check_unavailable",
        }),
      ],
    });
  });

  it("rejects a password reported by an injected breached-password checker", async () => {
    const checker: BreachedPasswordChecker = {
      async check() {
        return {
          occurrenceCount: 42,
          status: "breached",
        };
      },
    };
    const result = await evaluatePasswordPolicy(
      "violet sparrow orbit lantern",
      {},
      {
        breachedPasswordChecker: checker,
      },
    );

    expect(result).toMatchObject({
      accepted: false,
      breachCheck: {
        occurrenceCount: 42,
        status: "breached",
      },
      violations: [
        expect.objectContaining({
          code: "breached_password",
        }),
      ],
    });
  });
});
