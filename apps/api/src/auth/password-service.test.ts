import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password-service.js";

describe("password-service", () => {
  it("creates different stored hashes for the same password because salts are unique", () => {
    const firstHash = hashPassword("mohaircoat");
    const secondHash = hashPassword("mohaircoat");

    expect(firstHash).not.toBe(secondHash);
  });

  it("verifies the correct password and rejects an incorrect password", () => {
    const passwordHash = hashPassword("mohaircoat");

    expect(verifyPassword(passwordHash, "mohaircoat")).toMatchObject({
      isValid: true,
      needsRehash: false,
    });
    expect(verifyPassword(passwordHash, "wrongpass")).toMatchObject({
      isValid: false,
    });
  });

  it("never stores plaintext or a raw sha256 digest as the final password hash", () => {
    const password = "mohaircoat";
    const passwordHash = hashPassword(password);
    const legacySha256 = createHash("sha256").update(password).digest("hex");

    expect(passwordHash).not.toBe(password);
    expect(passwordHash).not.toBe(legacySha256);
    expect(passwordHash.startsWith("scrypt$")).toBe(true);
  });
});
