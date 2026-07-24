import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseJsonRequestBody } from "./request-body.js";

function createRequest(body: string, contentLength?: number) {
  const request = Readable.from([body]) as IncomingMessage;
  request.headers = contentLength
    ? {
        "content-length": String(contentLength),
      }
    : {};
  return request;
}

describe("parseJsonRequestBody", () => {
  it("parses a body within the configured limit", async () => {
    await expect(parseJsonRequestBody(createRequest('{"ok":true}'), 32)).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects a declared oversized body before reading it", async () => {
    await expect(parseJsonRequestBody(createRequest("{}", 100), 16)).rejects.toMatchObject({
      code: "payload_too_large",
      statusCode: 413,
    });
  });

  it("rejects a streamed body that crosses the limit", async () => {
    await expect(
      parseJsonRequestBody(createRequest('{"long":"payload"}'), 8),
    ).rejects.toMatchObject({
      code: "payload_too_large",
      statusCode: 413,
    });
  });

  it("returns a structured invalid-json error without echoing the body", async () => {
    await expect(
      parseJsonRequestBody(createRequest('{"password":"secret"'), 64),
    ).rejects.toMatchObject({
      code: "invalid_json",
      message: "The request body must be valid JSON.",
      statusCode: 400,
    });
  });
});
