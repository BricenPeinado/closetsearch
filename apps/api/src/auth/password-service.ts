import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const hashKeyLength = 64;
const saltLength = 16;
const scryptParameters = {
  N: 16_384,
  p: 1,
  r: 8,
};
const scryptPrefix = "scrypt";

export interface PasswordVerificationResult {
  isValid: boolean;
  needsRehash: boolean;
  upgradedHash?: string;
}

function encodeBuffer(value: Buffer) {
  return value.toString("base64url");
}

function decodeBuffer(value: string) {
  return Buffer.from(value, "base64url");
}

function formatScryptPasswordHash(salt: Buffer, derivedKey: Buffer) {
  const params = `N=${scryptParameters.N},r=${scryptParameters.r},p=${scryptParameters.p},keylen=${hashKeyLength}`;

  return `${scryptPrefix}$${params}$${encodeBuffer(salt)}$${encodeBuffer(derivedKey)}`;
}

function deriveScryptKey(password: string, salt: Buffer, keyLength: number) {
  return scryptSync(password, salt, keyLength, {
    maxmem: 64 * 1024 * 1024,
    ...scryptParameters,
  });
}

function parseScryptHash(passwordHash: string) {
  const [algorithm, paramsPart, saltPart, hashPart] = passwordHash.split("$");

  if (algorithm !== scryptPrefix || !paramsPart || !saltPart || !hashPart) {
    return null;
  }

  const params = new URLSearchParams(paramsPart.replaceAll(",", "&"));
  const N = Number.parseInt(params.get("N") ?? "", 10);
  const r = Number.parseInt(params.get("r") ?? "", 10);
  const p = Number.parseInt(params.get("p") ?? "", 10);
  const keyLength = Number.parseInt(params.get("keylen") ?? "", 10);

  if (
    !Number.isFinite(N) ||
    !Number.isFinite(r) ||
    !Number.isFinite(p) ||
    !Number.isFinite(keyLength) ||
    keyLength < 16
  ) {
    return null;
  }

  try {
    return {
      derivedKey: decodeBuffer(hashPart),
      keyLength,
      salt: decodeBuffer(saltPart),
    };
  } catch {
    return null;
  }
}

function isLegacySha256Hash(passwordHash: string) {
  return /^[a-f0-9]{64}$/i.test(passwordHash);
}

function verifyLegacySha256Hash(passwordHash: string, password: string) {
  const candidateHash = createHash("sha256").update(password).digest("hex");

  return timingSafeEqual(
    Buffer.from(candidateHash, "utf-8"),
    Buffer.from(passwordHash, "utf-8"),
  );
}

export function hashPassword(password: string) {
  const salt = randomBytes(saltLength);
  const derivedKey = deriveScryptKey(password, salt, hashKeyLength);

  return formatScryptPasswordHash(salt, derivedKey);
}

export function verifyPassword(
  passwordHash: string,
  password: string,
): PasswordVerificationResult {
  if (isLegacySha256Hash(passwordHash)) {
    const isValid = verifyLegacySha256Hash(passwordHash, password);

    return {
      isValid,
      needsRehash: isValid,
      upgradedHash: isValid ? hashPassword(password) : undefined,
    };
  }

  const parsedHash = parseScryptHash(passwordHash);

  if (!parsedHash) {
    return {
      isValid: false,
      needsRehash: false,
    };
  }

  const derivedKey = deriveScryptKey(password, parsedHash.salt, parsedHash.keyLength);
  const isValid =
    derivedKey.length === parsedHash.derivedKey.length &&
    timingSafeEqual(derivedKey, parsedHash.derivedKey);

  return {
    isValid,
    needsRehash: false,
  };
}
