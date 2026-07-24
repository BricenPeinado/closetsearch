import { randomUUID } from "node:crypto";

type LogLevel = "info" | "warn" | "error";

type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export type LogFields = Record<string, JsonValue | undefined>;

const sensitiveKeyPattern =
  /authorization|cookie|credential|password|secret|session|token|api[-_]?key/i;

function sanitizeValue(
  value: JsonValue | undefined,
  key?: string,
): JsonValue | undefined {
  if (key && sensitiveKeyPattern.test(key)) {
    return "[REDACTED]";
  }

  if (value === undefined || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item) ?? null);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([nestedKey, nestedValue]) => [
          nestedKey,
          sanitizeValue(nestedValue, nestedKey),
        ])
        .filter(([, nestedValue]) => nestedValue !== undefined),
    );
  }

  return value;
}

function writeLog(level: LogLevel, message: string, fields?: LogFields) {
  const sanitizedFields = fields
    ? (sanitizeValue(fields) as Record<string, JsonValue | undefined>)
    : undefined;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(sanitizedFields ?? {}),
  };

  const serializedEntry = JSON.stringify(entry);

  if (level === "error") {
    console.error(serializedEntry);
    return;
  }

  console.log(serializedEntry);
}

export function logInfo(message: string, fields?: LogFields) {
  writeLog("info", message, fields);
}

export function logWarn(message: string, fields?: LogFields) {
  writeLog("warn", message, fields);
}

export function logError(message: string, fields?: LogFields) {
  writeLog("error", message, fields);
}

export function createRequestId() {
  return randomUUID();
}
