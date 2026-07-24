import type { IncomingMessage } from "node:http";
import { ApiError } from "../api-error.js";

const defaultBodyLimitBytes = 64 * 1024;

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRequestBodyLimitBytes(env: Record<string, string | undefined> = process.env) {
  return parsePositiveInteger(env.HTTP_BODY_LIMIT_BYTES, defaultBodyLimitBytes);
}

export async function parseJsonRequestBody(
  request: IncomingMessage,
  limitBytes = getRequestBodyLimitBytes(),
) {
  const contentLength = Number.parseInt(
    typeof request.headers["content-length"] === "string" ? request.headers["content-length"] : "",
    10,
  );

  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new ApiError(
      413,
      "payload_too_large",
      `The request body exceeds the ${limitBytes}-byte limit.`,
    );
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;

    if (receivedBytes > limitBytes) {
      throw new ApiError(
        413,
        "payload_too_large",
        `The request body exceeds the ${limitBytes}-byte limit.`,
      );
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return null;
  }

  const body = Buffer.concat(chunks).toString("utf-8").trim();

  if (body.length === 0) {
    return null;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiError(400, "invalid_json", "The request body must be valid JSON.");
  }
}
