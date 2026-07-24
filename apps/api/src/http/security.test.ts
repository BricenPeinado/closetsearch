import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { assertCsrfSafeRequest, buildSecurityHeaders } from "./security.js";

function createRequest(method: string, headers: Record<string, string> = {}) {
  const request = Readable.from([]) as IncomingMessage;
  request.headers = headers;
  request.method = method;
  return request;
}

const productionEnv = {
  AUTH_ALLOWED_ORIGINS: "https://closetsearch.example",
  NODE_ENV: "production",
};

describe("HTTP security", () => {
  it("accepts an unsafe request from an explicitly allowed origin", () => {
    expect(() =>
      assertCsrfSafeRequest(
        createRequest("POST", {
          origin: "https://closetsearch.example",
          "sec-fetch-site": "same-site",
        }),
        productionEnv,
      ),
    ).not.toThrow();
  });

  it("rejects cross-site and untrusted origins", () => {
    expect(() =>
      assertCsrfSafeRequest(
        createRequest("POST", {
          origin: "https://attacker.example",
        }),
        productionEnv,
      ),
    ).toThrowError("not allowed");
    expect(() =>
      assertCsrfSafeRequest(
        createRequest("POST", {
          "sec-fetch-site": "cross-site",
        }),
        productionEnv,
      ),
    ).toThrowError("Cross-site");
  });

  it("emits browser hardening headers and production HSTS", () => {
    expect(buildSecurityHeaders(productionEnv)).toMatchObject({
      "content-security-policy": expect.stringContaining("frame-ancestors"),
      "strict-transport-security": expect.stringContaining("max-age"),
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });
  });
});
